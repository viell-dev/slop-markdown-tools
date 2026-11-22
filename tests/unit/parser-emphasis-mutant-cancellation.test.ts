import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  createMutantCancellation,
  createPhaseTimeline,
  removeMutantFolder,
  runCoverageChild,
} from "../support/parser/parser-emphasis-production-support.mjs";

// The registration-mutant tests pass Vitest's context signal and
// `onTestFinished` here (#995). A stand-in controller and an explicit
// `finish()` call replace the timeout and the hook, so no test waits for one.
function recorded() {
  const controller = new AbortController();
  const written: unknown[][] = [];
  const timeline = createPhaseTimeline("Missing-core mutant", {
    now: () => 0,
    write: (...values) => written.push(values),
  });
  const cancellation = createMutantCancellation(controller.signal, timeline);
  const events: string[] = [];
  const remove = cancellation.own(async () => {
    events.push("removed");
    await Promise.resolve();
  });
  const phases = () => (timeline.report().phases as { phase: string }[]).map(({ phase }) => phase);
  return { controller, timeline, cancellation, events, remove, phases, written };
}

function deferred() {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { release, released };
}

it("removes a cancelled test's folder once its abandoned body has stopped", async () => {
  const { controller, timeline, cancellation, events, phases } = recorded();
  const step = deferred();
  timeline.mark("copy-dist", { files: 3 });
  const body = cancellation.run(async () => {
    await step.released; // A copy or hash that is under way when the test times out.
    events.push("body-stopped");
    controller.signal.throwIfAborted();
    events.push("body-continued");
  });
  controller.abort(new Error("Test timed out in 30000ms.\nIf this is a long-running test, ..."));
  expect(timeline.report().phases).toContainEqual({
    phase: "aborted",
    elapsedMs: 0,
    reason: "Test timed out in 30000ms.",
  });
  const finishing = cancellation.finish();
  await new Promise((resolve) => setImmediate(resolve));
  expect(events).toEqual([]); // Removal waits for the body rather than racing it.
  step.release();
  await finishing;
  await expect(body).rejects.toBe(controller.signal.reason);
  expect(events).toEqual(["body-stopped", "removed"]);
  expect(phases()).toEqual(["copy-dist", "aborted"]);
});

it("runs each removal once when the body and the finished hook both ask", async () => {
  const { controller, cancellation, events, remove } = recorded();
  await cancellation.run(async () => {
    await remove(); // The body's own `cleanup()` in its `finally`.
  });
  controller.abort(new Error("Test timed out in 30000ms."));
  await cancellation.finish();
  expect(events).toEqual(["removed"]);
});

it("leaves the folder to the body when the test was not cancelled", async () => {
  const { controller, cancellation, events, phases, written } = recorded();
  // A setup failure keeps its folder for inspection; it is not a cancellation.
  const body = cancellation.run(() => Promise.reject(new Error("Dist file catalog changed")));
  await expect(body).rejects.toThrow("Dist file catalog changed");
  await cancellation.finish();
  // After the finished hook, a late abort, such as the run ending, marks nothing.
  controller.abort(new Error("Cancelled"));
  expect(events).toEqual([]);
  expect(phases()).toEqual([]);
  expect(written).toEqual([]);
});

it("refuses to spawn the coverage child once cancelled", async () => {
  const controller = new AbortController();
  const reason = new Error("Test timed out in 30000ms.");
  controller.abort(reason);
  const timeline = createPhaseTimeline("Missing-core mutant", { now: () => 0 });
  const request = { schema: 1, sourceRoot: ".", runtimeRoot: ".", cases: [] };
  await expect(runCoverageChild(request as never, timeline, controller.signal)).rejects.toBe(
    reason,
  );
  expect(timeline.report().phases).toEqual([]);
});

// Synthetic folders stand in for the temporary folder and `node_modules`.
let parent: string | undefined;
afterEach(async () => {
  if (!parent) return;
  // Unlink any junction a refused removal left before removing the rest.
  for (const name of await readdir(parent)) {
    const link = path.join(parent, name, "node_modules");
    if ((await lstat(link).catch(() => undefined))?.isSymbolicLink()) await rm(link);
  }
  await rm(parent, { recursive: true });
  parent = undefined;
});

async function synthetic() {
  parent = await realpath(await mkdtemp(path.join(tmpdir(), "mdrefine-mutant-removal-")));
  const modules = path.join(parent, "modules");
  await mkdir(modules);
  await writeFile(path.join(modules, "keep.js"), "export {};\n");
  const folder = async (name = "mdrefine-emphasis-registration-test", linked = false) => {
    const owned = path.join(parent ?? "", name);
    await mkdir(path.join(owned, "dist"), { recursive: true });
    await writeFile(path.join(owned, "dist", "index.js"), "export {};\n");
    if (linked)
      await symlink(
        modules,
        path.join(owned, "node_modules"),
        process.platform === "win32" ? "junction" : "dir",
      );
    return owned;
  };
  return { tempParent: parent, modules, folder };
}

const exists = (filename: string) =>
  lstat(filename).then(
    () => true,
    () => false,
  );

it("removes a copy cut short before its junction was made", async () => {
  const { tempParent, folder } = await synthetic();
  const owned = await folder();
  await removeMutantFolder({ owned, tempParent });
  expect(await exists(owned)).toBe(false);
});

it("unlinks the junction without following it before removing the copy", async () => {
  const { tempParent, modules, folder } = await synthetic();
  const owned = await folder(undefined, true);
  await removeMutantFolder({ owned, tempParent, modules });
  expect(await exists(owned)).toBe(false);
  expect(await readFile(path.join(modules, "keep.js"), "utf8")).toBe("export {};\n");
});

it("keeps folders that fail an ownership check", async () => {
  const { tempParent, modules, folder } = await synthetic();
  // Not a mutant folder by name.
  const foreign = await folder("kept");
  await expect(removeMutantFolder({ owned: foreign, tempParent })).rejects.toThrow();
  expect(await exists(path.join(foreign, "dist", "index.js"))).toBe(true);
  await rm(foreign, { recursive: true });
  // A link that the work had not recorded making.
  const unrecorded = await folder("mdrefine-emphasis-registration-kept", true);
  await expect(removeMutantFolder({ owned: unrecorded, tempParent })).rejects.toThrow(
    "Unexpected entry",
  );
  expect(await exists(path.join(unrecorded, "dist", "index.js"))).toBe(true);
  await rm(path.join(unrecorded, "node_modules"));
  // Not directly inside the temporary folder.
  await expect(removeMutantFolder({ owned: unrecorded, tempParent: modules })).rejects.toThrow();
  expect(await exists(path.join(unrecorded, "dist", "index.js"))).toBe(true);
  expect(await readFile(path.join(modules, "keep.js"), "utf8")).toBe("export {};\n");
});
