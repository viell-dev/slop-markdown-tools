import { expect, it } from "vitest";
import { convertConfig, format, lint, parse, semanticFingerprint } from "../../src/index.js";

function settings(options: Record<string, unknown> = {}) {
  const converted = convertConfig({ markdownlint: { default: false, MD041: options } });
  return { config: converted.config, compatibility: converted.compatibility };
}
function nestedDirectives(count: number) {
  return `<script x=>\n\n${":::a\n".repeat(count)}<h1>\n${":::\n".repeat(count)}\n</script>\n`;
}
function unchanged(source: string, options: Record<string, unknown> = {}) {
  const configured = settings(options);
  const result = format(source, configured);
  expect(result.output).toBe(source);
  expect(result.diagnostics.some((finding) => finding.rule.startsWith("engine/"))).toBe(false);
  expect(format(result.output, configured).output).toBe(source);
  expect(semanticFingerprint(parse(result.output, "github"))).toBe(
    semanticFingerprint(parse(source, "github")),
  );
}

// Verified against markdownlint 0.42.0, including its HTML-flow reparse.
it.each(["\n", "\r\n"])(
  "recognizes the first inline HTML heading after malformed flow with %j",
  (eol) => {
    for (const text of [
      "<h1 x=>Title</h1>\n",
      "<h1 id=bad'value>Title</h1>\n",
      "<h1 x=>![<h1>](image.png)\n",
      "<h1 x=>[<h1>][missing]\n",
      "<!-- unclosed <h1>\n",
    ]) {
      const source = text.replaceAll("\n", eol);
      expect(lint(source, settings()), source).toEqual([]);
      unchanged(source);
    }
  },
);

it.each([
  "<h1 x=>`<h1>`\n",
  "<h1 x=>\\</h1>\n",
  "<h1 x=><!-- <h1> -->\n",
  "<h1 x=>$<h1>$\n",
  "<h1 x=>a$ <h1> $b\n",
  "<h1 x=>$$<h1>$still$$\n",
  "<h1 x=>![`<h1>`](image.png)\n",
  '<script x=>\n\n::note{value="<h1>"}\n\n</script>\n',
  '<script x=>\n\n:::note{value="<h1>"}\ntext\n:::\n\n</script>\n',
  "<script x=>\n$$\n<h1>\n$$\n</script>\n",
])("does not count HTML-looking text inside a protected construct: %j", (source) => {
  expect(lint(source, settings())).toEqual([
    expect.objectContaining({ rule: "structure/initial-heading", line: 1 }),
  ]);
  unchanged(source);
});

it.each(["<h1", "<h1 / >\n", "<!-- note --><h1>Title</h1>\n"])(
  "permits unrecognized HTML flow as a preamble: %j",
  (source) => {
    expect(lint(source, settings({ allow_preamble: true }))).toEqual([]);
    unchanged(source, { allow_preamble: true });
  },
);

it("uses the configured level and the original flow's location", () => {
  const source = "<!-- note -->\n<h2 x=>Title</h2>\n\n<h1>Later</h1>\n";
  expect(lint(source, settings({ level: 2, allow_preamble: true }))).toEqual([]);
  expect(lint(source, settings({ allow_preamble: true }))).toEqual([
    expect.objectContaining({ rule: "structure/initial-heading", line: 2 }),
  ]);
});

it("keeps directives effective and native heading policy unchanged", () => {
  const source = "<h1 x=>Title</h1>\n";
  const configured = settings();
  expect(lint(source, configured)).toEqual([]);
  expect(lint(source, { config: configured.config })).toHaveLength(1);
  expect(lint("<!-- markdownlint-disable MD041 -->\n<h2 x=>Title</h2>\n", configured)).toEqual([]);
  expect(
    lint(
      '<!-- markdownlint-configure-file {"MD041":{"level":2}} -->\n<h2 x=>Title</h2>\n',
      configured,
    ),
  ).toEqual([]);
});

it.each(["\n", "\r\n", "\r"])("reparses tags containing a blank line with %j", (eol) => {
  for (const opener of ["<pre\n\nx>", "<script\n\nx>", "<pre\n\n>"]) {
    const source = `${opener}\n<h1>a</h1>\n</pre>\n`.replaceAll("\n", eol);
    expect(lint(source, settings())).toEqual([]);
    expect(lint(source, settings({ level: 2, allow_preamble: true }))).toEqual([
      expect.objectContaining({ rule: "structure/initial-heading", line: 1 }),
    ]);
    unchanged(source);
  }
});

it.each(["\n", "\r\n", "\r"])("reparses interrupted multiline tags with %j (#860)", (eol) => {
  for (const text of [
    '<div\n  class="a"\n  id="b"\n>\n<h1>Title</h1>\n</div>\n',
    "<pre\nx\n>\n<h1>a</h1>\n</pre>\n",
    "</div\n>\n<h1>a</h1>\n",
    '<pre title="a\n# b">\n<h1>a</h1>\n</pre>\n',
    '<pre title="a\n===\nb">\n<h1>a</h1>\n</pre>\n',
  ]) {
    const source = text.replaceAll("\n", eol);
    expect(lint(source, settings())).toEqual([]);
    expect(lint(source, settings({ level: 2, allow_preamble: true }))).toEqual([
      expect.objectContaining({ rule: "structure/initial-heading", line: 1 }),
    ]);
    unchanged(source);
  }
});

it.each(["\n", "\r\n", "\r"])("retains complete multiline inline tags with %j", (eol) => {
  const heading = '<h1\nid="x">Title</h1>\n'.replaceAll("\n", eol);
  expect(lint(heading, settings())).toEqual([]);
  expect(lint(heading, settings({ level: 2 }))).toHaveLength(1);
  unchanged(heading);
  const pre = '<pre title="a\nb\nc">\n<h1>a</h1>\n</pre>\n'.replaceAll("\n", eol);
  expect(lint(pre, settings())).toHaveLength(1);
  expect(lint(pre, settings({ allow_preamble: true }))).toEqual([]);
  unchanged(pre);
});

it("keeps complete leading tags on the fast path even with a deeply nested body", () => {
  const source = nestedDirectives(2500).replace("<script x=>", "<script>");
  const findings = lint(source, settings());
  expect(findings).toHaveLength(1);
  expect(findings[0]!.message).not.toContain("work limit");
  unchanged(source);
});

it("reports bounded directive inspection without edits or leaked state (#858)", () => {
  const source = nestedDirectives(250);
  for (const options of [{}, { allow_preamble: true }]) {
    const findings = lint(source, settings(options));
    expect(findings).toEqual([
      expect.objectContaining({
        rule: "structure/initial-heading",
        line: 1,
      }),
    ]);
    expect(findings[0]!.message).toContain("directive work limit");
    expect(findings[0]!.edit).toBeUndefined();
    unchanged(source, options);
  }
  expect(lint(nestedDirectives(5), settings())).toEqual([]);
  expect(lint(`<!-- markdownlint-disable-file MD041 -->\n${source}`, settings())).toEqual([]);
  const native = lint(source, { config: settings().config });
  expect(native).toHaveLength(1);
  expect(native[0]!.message).not.toContain("work limit");
});

it("accepts ordinary sibling and nested directives without reaching the work limit", () => {
  for (const body of [
    ":::a\ntext\n:::\n\n".repeat(200),
    `${":::a\n".repeat(5)}text\n${":::\n".repeat(5)}`,
  ]) {
    const source = `<script x=>\n\n${body}\n<h1>\n</script>\n`;
    expect(lint(source, settings())).toEqual([]);
    unchanged(source);
  }
});
