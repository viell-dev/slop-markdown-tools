import { expect, it } from "vitest";
import { convertConfig, format, lint, parse, semanticFingerprint } from "../../src/index.js";

function settings(options: Record<string, unknown> = {}) {
  const converted = convertConfig({ markdownlint: { default: false, MD041: options } });
  return { config: converted.config, compatibility: converted.compatibility };
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
