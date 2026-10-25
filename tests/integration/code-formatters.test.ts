import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { format, parse, semanticFingerprint } from "../../src/index.js";
import { formatWithCode } from "../../src/node.js";
import { repository, run } from "../support/cli.js";
import { parseReport } from "../support/json.js";
import { block, calls, fence, setup } from "../support/code-format.js";

it("executes only through the asynchronous Node API and keeps ordinary fingerprints strict", async () => {
  const { root, record, config } = await setup();
  const source = block();
  expect(format(source, { config: config() }).output).toBe(source);
  await expect(readFile(record)).rejects.toMatchObject({ code: "ENOENT" });
  const result = await formatWithCode(source, { config: config(), cwd: root, path: "note.md" });
  expect(result).toEqual({ output: block("formatted"), changed: true, diagnostics: [] });
  expect(semanticFingerprint(parse(source, "github"))).not.toBe(
    semanticFingerprint(parse(result.output, "github")),
  );
  expect(
    await formatWithCode(result.output, { config: config(), cwd: root, path: "note.md" }),
  ).toEqual({ ...result, changed: false });
  expect((await calls(record))[0]).toMatchObject({
    source: "old\n",
    filepath: path.join(root, "note.md"),
    cwd: root,
  });
});

it("uses exact aliases, a fallback, exclusions, and document order", async () => {
  const { root, record, tool, config } = await setup("serial");
  const exact = tool({
    languages: ["js", "javascript"],
    args: [path.join(root, "adapter.mjs"), "serial", "{filepath}", record, "exact"],
  });
  const fallback = tool({
    id: "fallback",
    languages: ["*"],
    args: [path.join(root, "adapter.mjs"), "serial", "{filepath}", record, "fallback"],
  });
  const source = [
    block("one", "javascript"),
    block("two", "JS"),
    block("three", "js"),
    block("four", ""),
  ].join("\n");
  const result = await formatWithCode(source, {
    config: config([exact, fallback]),
    cwd: root,
    path: "note.md",
  });
  expect(result.diagnostics).toEqual([]);
  expect(result.output).toBe(
    [
      block("exact", "javascript"),
      block("fallback", "JS"),
      block("exact", "js"),
      block("four", ""),
    ].join("\n"),
  );
  expect((await calls(record)).map(({ source, label }) => [source, label])).toEqual([
    ["one\n", "exact"],
    ["two\n", "fallback"],
    ["three\n", "exact"],
  ]);
  const excluded = await formatWithCode(block(), {
    cwd: root,
    path: "draft/note.md",
    config: config([{ ...exact, exclude: ["draft/**"] }, fallback]),
  });
  expect(excluded.output).toBe(block());
  expect(await calls(record)).toHaveLength(3);
});

describe("fenced source layout", () => {
  const layouts = [
    [block(), block("formatted")],
    [`  ${fence}js\n  old\n${fence}\n`, `  ${fence}js\n  formatted\n${fence}\n`],
    [`- ${fence}js\n  old\n  ${fence}\n`, `- ${fence}js\n  formatted\n  ${fence}\n`],
    [`> - ${fence}js\n>   old\n>   ${fence}\n`, `> - ${fence}js\n>   formatted\n>   ${fence}\n`],
    [
      `[^long]: ${fence}js\n    old\n    ${fence}\n`,
      `[^long]: ${fence}js\n    formatted\n    ${fence}\n`,
    ],
    [
      `- [^long]: ${fence}js\n      old\n      ${fence}\n`,
      `- [^long]: ${fence}js\n      formatted\n      ${fence}\n`,
    ],
    [
      `> [^long]: ${fence}js\n>     old\n>     ${fence}\n`,
      `> [^long]: ${fence}js\n>     formatted\n>     ${fence}\n`,
    ],
    [block("", 'js title="two words"'), block("formatted", 'js title="two words"')],
    [`${fence}js\nold`, `${fence}js\nformatted\n`],
    [`${fence}js`, `${fence}js\nformatted\n`],
  ];
  it.each(layouts)("preserves containers and metadata for %j", async (source, expected) => {
    const { root, config } = await setup();
    for (const newline of source.includes("\n") ? ["\n", "\r\n", "\r"] : ["\n"]) {
      const result = await formatWithCode(source.replaceAll("\n", newline), {
        config: config(),
        cwd: root,
      });
      expect(result.diagnostics).toEqual([]);
      expect(result.output).toBe(expected.replaceAll("\n", newline));
      expect((await formatWithCode(result.output, { config: config(), cwd: root })).output).toBe(
        result.output,
      );
    }
  });
});

it("lengthens colliding fences and preserves a byte order mark", async () => {
  const { root, config } = await setup("collision");
  const mark = String.fromCharCode(0xfeff);
  const source = mark + block();
  const result = await formatWithCode(source, {
    cwd: root,
    config: { ...config(), extends: ["recommended"] },
  });
  expect(result.diagnostics).toEqual([]);
  expect(result.output).toBe(mark + `${fence}\`js\nbefore\n${fence}\nafter\n${fence}\`\n`);
  expect(
    (
      await formatWithCode(result.output, {
        cwd: root,
        config: { ...config(), extends: ["recommended"] },
      })
    ).output,
  ).toBe(result.output);
});

it("changes code after TOML in both readings, and refuses to change a different front-matter reading", async () => {
  const { root, config } = await setup();
  const toml = `+++\ntitle = "Title"\n+++\n\n${block()}`;
  const allowed = await formatWithCode(toml, { cwd: root, config: config() });
  expect(allowed.diagnostics).toEqual([]);
  expect(allowed.output).toBe(toml.replace("old", "formatted"));
  const ambiguous = `---\ntitle: Title\n${fence}js\nold\n---\ntail\n${fence}\n`;
  const refused = await formatWithCode(ambiguous, { cwd: root, config: config() });
  expect(refused.output).toBe(ambiguous);
  expect(refused.diagnostics).toEqual([
    expect.objectContaining({ rule: "engine/code-formatter", severity: "error" }),
  ]);
});

it("refuses code whitespace changes that alter an alternate GitHub heading anchor", async () => {
  const { root, config, tool } = await setup();
  const source = await readFile(
    new URL("../fixtures/front-matter-heading.md", import.meta.url),
    "utf8",
  );
  const collapse = tool({
    args: [
      "--input-type=module",
      "-e",
      `
    let source = "";
    for await (const chunk of process.stdin) source += chunk;
    process.stdout.write(source.replaceAll("  ", " "));
  `,
    ],
  });
  const configured = config([collapse]);
  const refused = await formatWithCode(source, { cwd: root, config: configured });
  expect(refused.output).toBe(source);
  expect(refused.diagnostics).toEqual([
    expect.objectContaining({ rule: "engine/code-formatter", severity: "error" }),
  ]);
  const ordinary = block("a  b");
  expect((await formatWithCode(ordinary, { cwd: root, config: configured })).output).toBe(
    block("a b"),
  );
});

it.each(["fail", "invalid", "oversize", "timeout"])(
  "retains a %s tool's block while keeping safe Markdown edits",
  async (mode) => {
    const { root, config, tool } = await setup(mode);
    const source = "A *word*.\n\n" + block();
    const configured = {
      ...config([tool({ timeoutMs: 1000, maxOutputBytes: 64 })]),
      extends: ["recommended"],
    };
    const result = await formatWithCode(source, { cwd: root, config: configured });
    expect(result.output).toBe("A _word_.\n\n" + block());
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ rule: "engine/code-formatter", severity: "error", line: 3 }),
    ]);
  },
);

it("respects suppression regions and widened range scope", async () => {
  const { root, record, config } = await setup();
  const source = "A *word*.\n\n" + block("first") + "\n" + block("second");
  const at = source.indexOf("second");
  const scoped = await formatWithCode(source, {
    cwd: root,
    config: config(),
    ranges: [{ start: at, end: at + 1 }],
  });
  expect(scoped.output).toBe(source.replace("second", "formatted"));
  expect(scoped.scope).toEqual([
    { start: source.lastIndexOf(fence + "js") - 1, end: scoped.output.length },
  ]);
  const disabled = `<!-- mdrefine-disable ${"engine/code-formatter"} -->\n\n${block()}\n<!-- mdrefine-enable engine/code-formatter -->\n\n${block("last")}`;
  expect((await formatWithCode(disabled, { cwd: root, config: config() })).output).toBe(
    disabled.replace("last", "formatted"),
  );
  expect(await calls(record)).toHaveLength(2);
});

it("matches CLI preview, check, JSON, stdin, and writes", async () => {
  const { root, config } = await setup();
  const source = block();
  await writeFile(path.join(root, "note.md"), source);
  await writeFile(path.join(root, "mdrefine.config.json"), JSON.stringify(config()));
  const expected = await formatWithCode(source, { cwd: root, path: "note.md", config: config() });
  const checked = run(root, ["format", "--check", "--json", "note.md"]);
  expect(checked.status, checked.stderr).toBe(1);
  expect(parseReport(checked.stdout).files).toEqual([
    { path: "note.md", changed: true, diagnostics: [] },
  ]);
  expect(run(root, ["lint", "--json", "note.md"]).status).toBe(0);
  const stdin = run(root, ["format", "-", "--stdin-filepath", "note.md"], source);
  expect([stdin.status, stdin.stdout]).toEqual([0, expected.output]);
  expect(run(root, ["format", "--diff", "note.md"]).stdout).toContain("+formatted");
  const written = run(root, ["format", "--write", "note.md"]);
  expect(written.status, written.stderr).toBe(0);
  expect(await readFile(path.join(root, "note.md"), "utf8")).toBe(expected.output);
  expect(run(root, ["format", "--check", "note.md"]).status).toBe(0);
});

it("uses the actual installed Prettier executable", async () => {
  const source = block("const x={a:1}");
  const result = await formatWithCode(source, {
    cwd: repository,
    config: {
      extends: [],
      codeFormatters: [
        {
          id: "prettier",
          languages: ["js"],
          command: "prettier",
          args: ["--stdin-filepath", "{filepath}.js"],
        },
      ],
    },
  });
  expect(result.diagnostics).toEqual([]);
  expect(result.output).toBe(block("const x = { a: 1 };"));
});

it("preserves separately chosen fence lengths when fence styling is disabled", async () => {
  const { root, config } = await setup();
  const source = `${fence}js\nold\n${fence}\`\`\n`;
  const result = await formatWithCode(source, { cwd: root, config: config() });
  expect(result.diagnostics).toEqual([]);
  expect(result.output).toBe(source.replace("old", "formatted"));
});

it("keeps fence runs whose style rule is suppressed while formatting their code", async () => {
  const { root, config } = await setup();
  const source = `<!-- mdrefine-disable style/code-fence -->\n\n${fence}\`\`\`js\nold\n${fence}\`\`\`\`\`\n`;
  const result = await formatWithCode(source, {
    cwd: root,
    config: { ...config(), extends: ["recommended"] },
  });
  expect(result.diagnostics).toEqual([]);
  expect(result.output).toBe(source.replace("old", "formatted"));
});

it("does not replace an invalid Unicode input on its way to a tool", async () => {
  const { root, record, config } = await setup("echo");
  const source = block(String.fromCharCode(0xd800));
  const result = await formatWithCode(source, { cwd: root, config: config() });
  expect(result.output).toBe(source);
  expect(result.diagnostics).toEqual([expect.objectContaining({ rule: "engine/code-formatter" })]);
  await expect(readFile(record)).rejects.toMatchObject({ code: "ENOENT" });
});

it("counts encoding marks in error offsets while reporting visible columns", async () => {
  const { root, config } = await setup("fail");
  for (const count of [1, 2]) {
    const mark = String.fromCharCode(0xfeff).repeat(count);
    const source = mark + block();
    const result = await formatWithCode(source, { cwd: root, config: config() });
    expect(result.output).toBe(source);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        rule: "engine/code-formatter",
        start: mark.length,
        line: 1,
        column: 1,
      }),
    ]);
  }
});
