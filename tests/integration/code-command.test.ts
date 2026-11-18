import { spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";
import { terminationWaitMs } from "../../src/code/terminate.js";
import { formatWithCode } from "../../src/node.js";
import { block, calls, setup } from "../support/code-format.js";
import { cli, run } from "../support/cli.js";
import { parseReport } from "../support/json.js";

afterEach(() => vi.unstubAllEnvs());

it("finds a local command before PATH and passes filename arguments literally", async () => {
  const { root, record, tool, config } = await setup();
  const local = path.join(root, "node_modules", ".bin");
  const other = path.join(root, "path-bin");
  await mkdir(local, { recursive: true });
  await mkdir(other);
  const windows = process.platform === "win32";
  const name = windows ? "probe-code.cmd" : "probe-code";
  const quote = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
  const script = windows
    ? `@echo off\r\n"${process.execPath}" "${path.join(root, "adapter.mjs")}" %*\r\n`
    : `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.join(root, "adapter.mjs"))} "$@"\n`;
  await writeFile(path.join(local, name), script);
  await writeFile(path.join(other, name), windows ? "@exit /b 88\r\n" : "#!/bin/sh\nexit 88\n");
  if (!windows) {
    await chmod(path.join(local, name), 0o755);
    await chmod(path.join(other, name), 0o755);
  }
  vi.stubEnv("PATH", `${other}${path.delimiter}${process.env.PATH ?? ""}`);
  const filename = "nested/Östra %PATH% & (x)! [a].md";
  const result = await formatWithCode(block(), {
    cwd: root,
    path: filename,
    config: config([tool({ command: "probe-code", args: ["constant", "{filepath}", record] })]),
  });
  expect(result.diagnostics).toEqual([]);
  expect(result.output).toBe(block("formatted"));
  expect((await calls(record))[0]?.filepath).toBe(path.resolve(root, filename));
});

it("reports missing commands with exit 2 and still writes safe edits to both files", async () => {
  const { root, tool, config } = await setup();
  const configured = {
    ...config([
      tool({ command: path.join(root, "not-an-executable") }),
      tool({ id: "rust", languages: ["rs"] }),
    ]),
    extends: ["recommended"],
  };
  await writeFile(path.join(root, "mdrefine.config.json"), JSON.stringify(configured));
  await writeFile(path.join(root, "bad.md"), "A *word*.\n\n" + block());
  await writeFile(path.join(root, "good.md"), block("old", "rs"));
  const result = run(root, ["format", "--write", "--json", "bad.md", "good.md"]);
  expect(result.status).toBe(2);
  const report = parseReport(result.stdout);
  expect(report.files).toEqual([
    {
      path: "bad.md",
      changed: true,
      diagnostics: [expect.objectContaining({ rule: "engine/code-formatter", severity: "error" })],
    },
    { path: "good.md", changed: true, diagnostics: [] },
  ]);
  expect(await readFile(path.join(root, "bad.md"), "utf8")).toBe("A _word_.\n\n" + block());
  expect(await readFile(path.join(root, "good.md"), "utf8")).toBe(block("formatted", "rs"));
});

it("terminates the processes a stopped formatter started", async () => {
  const { root, record, tool, config } = await setup("tree");
  const source = block();
  // The fixture exceeds the output limit once its child writes; the timeout
  // lies beyond the test's own deadline, so only that limit stops it.
  const result = await formatWithCode(source, {
    cwd: root,
    config: config([tool({ timeoutMs: 60000, maxOutputBytes: 64 })]),
  });
  expect(result.output).toBe(source);
  expect(result.diagnostics).toEqual([
    expect.objectContaining({
      rule: "engine/code-formatter",
      message:
        'Code formatter "javascript" exceeded its 64 byte output limit; this block was left unchanged.',
    }),
  ]);
  const before = await readFile(record + ".heartbeat", "utf8");
  await setTimeout(250);
  expect(await readFile(record + ".heartbeat", "utf8")).toBe(before);
});

it.skipIf(process.platform !== "win32")(
  "lets the CLI exit when taskkill stalls with its pipes open",
  async () => {
    const { root, tool, config } = await setup("timeout");
    await writeFile(
      path.join(root, "mdrefine.config.json"),
      JSON.stringify(config([tool({ timeoutMs: 1000 })])),
    );
    await writeFile(path.join(root, "note.md"), block());
    const stalled = new URL("../fixtures/stalled-taskkill.mjs", import.meta.url).href;
    // A CLI held open by the stand-in would run until this limit ends it.
    const result = spawnSync(
      process.execPath,
      ["--import", stalled, cli, "format", "--json", "note.md"],
      { cwd: root, encoding: "utf8", timeout: 40000 },
    );
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(parseReport(result.stdout).files[0]?.diagnostics).toEqual([
      expect.objectContaining({
        message: `Code formatter "javascript" exceeded its 1000 ms timeout, and its processes may still be running (not confirmed stopped within ${terminationWaitMs} ms); this block was left unchanged.`,
      }),
    ]);
  },
  // The formatter's timeout and the termination wait take 11 seconds.
  50000,
);

it("keeps a document changed during the formatter run instead of overwriting it", async () => {
  const { root, config } = await setup("rewrite");
  await writeFile(path.join(root, "mdrefine.config.json"), JSON.stringify(config()));
  await writeFile(path.join(root, "note.md"), block());
  const result = run(root, ["format", "--write", "--json", "note.md"]);
  expect(result.status).toBe(2);
  expect(await readFile(path.join(root, "note.md"), "utf8")).toBe("outside change\n");
  expect(parseReport(result.stdout).files[0]?.diagnostics).toEqual([
    expect.objectContaining({ rule: "engine/unwritable-file", severity: "error" }),
  ]);
});
