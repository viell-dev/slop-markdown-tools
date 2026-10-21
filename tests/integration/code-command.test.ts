import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";
import { formatWithCode } from "../../src/node.js";
import { block, calls, setup } from "./code-format-support.js";
import { run } from "./support.js";
import { parseReport } from "./json.js";
import { stringContaining } from "../assertions.js";

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
  await writeFile(path.join(root, "mdtools.config.json"), JSON.stringify(configured));
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

it("terminates the formatter's child process on a timeout", async () => {
  const { root, record, tool, config } = await setup("tree");
  const source = block();
  const result = await formatWithCode(source, {
    cwd: root,
    config: config([tool({ timeoutMs: 3000 })]),
  });
  expect(result.output).toBe(source);
  expect(result.diagnostics).toEqual([
    expect.objectContaining({
      rule: "engine/code-formatter",
      message: stringContaining("timeout"),
    }),
  ]);
  const before = await readFile(record + ".heartbeat", "utf8");
  await setTimeout(250);
  expect(await readFile(record + ".heartbeat", "utf8")).toBe(before);
});

it("keeps a document changed during the formatter run instead of overwriting it", async () => {
  const { root, config } = await setup("rewrite");
  await writeFile(path.join(root, "mdtools.config.json"), JSON.stringify(config()));
  await writeFile(path.join(root, "note.md"), block());
  const result = run(root, ["format", "--write", "--json", "note.md"]);
  expect(result.status).toBe(2);
  expect(await readFile(path.join(root, "note.md"), "utf8")).toBe("outside change\n");
  expect(parseReport(result.stdout).files[0]?.diagnostics).toEqual([
    expect.objectContaining({ rule: "engine/unwritable-file", severity: "error" }),
  ]);
});
