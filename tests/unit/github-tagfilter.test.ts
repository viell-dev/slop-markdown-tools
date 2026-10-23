import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createWorkspace, format, lint, parse, semanticFingerprint } from "../../src/index.js";
import type { Plugin } from "../../src/index.js";
import { forgeAnchors, githubAnchors } from "../../src/workspace/anchors.js";
import {
  htmlAnchors,
  htmlHeadings,
  htmlText,
  htmlTokens,
  htmlView,
  htmlViewUncertain,
} from "../../src/workspace/html.js";

interface TagfilterFixture {
  name: string;
  source: string;
  /** IDs actually observed in retained GitHub Markdown API HTML (markdown mode). */
  observedIds: string[];
  /** The exact IDs this bounded local model is allowed to claim. */
  knownIds: string[];
  complete: boolean;
}

// Synthetic GitHub Markdown API renders retained on 2026-10-22. The malformed table and
// inline attribute cases deliberately remain incomplete despite known live IDs.
const fixtures = JSON.parse(
  readFileSync(new URL("../fixtures/renderers/github-tagfilter.json", import.meta.url), "utf8"),
) as TagfilterFixture[];
const families = [
  "iframe",
  "noembed",
  "noframes",
  "plaintext",
  "script",
  "style",
  "title",
  "textarea",
  "xmp",
];
const github = { tagfilter: "github" as const };
const config = { extends: ["recommended", "github"] };

describe("GitHub filtered HTML tags (#541)", () => {
  it.each(fixtures)("matches supported live anchors for $name", (fixture) => {
    const anchors = githubAnchors(parse(fixture.source, "github"));
    expect(anchors.complete).toBe(fixture.complete);
    expect([...new Set([...anchors.slugs, ...anchors.explicit])].sort()).toEqual(
      [...fixture.knownIds].sort(),
    );
    const workspace = createWorkspace({ "Note.md": fixture.source });
    for (const id of fixture.observedIds) {
      const result = workspace.resolve("From.md", `Note.md#${id}`, "github");
      if (fixture.knownIds.includes(id))
        expect(result).toMatchObject({ status: "resolved", fragmentExists: true });
      else expect(result).toMatchObject({ status: "unreadable", fragmentIncomplete: true });
    }
    const absent = workspace.resolve("From.md", "Note.md#absent", "github");
    if (fixture.complete) expect(absent.fragmentExists).toBe(false);
    else expect(absent).toMatchObject({ status: "unreadable", fragmentIncomplete: true });
  });

  it.each(families)("escapes %s tags while parsing their flow content as HTML", (tag) => {
    const node = {
      type: "html" as const,
      value: `<${tag} id="wrapper"><a id="child" name="named">x</a><h2>Title</h2></${tag}>`,
    };
    const tokens = htmlTokens(htmlView(node, { ...github, flow: true }));
    expect(htmlAnchors(tokens)).toEqual(["child", "named"]);
    expect(htmlHeadings(tokens)).toEqual([{ text: "Title", hasId: false }]);
    // Defaults used by Forgejo/Gitea/VitePress are not GFM serialization.
    expect(htmlView(node)).toBe(node.value);
    expect(htmlAnchors(htmlTokens(htmlView(node)))).toEqual([]);
    expect(htmlHeadings(htmlTokens(htmlView(node)))).toEqual([]);
  });

  it.each(families)("recognizes mixed-case and self-closing %s spellings", (tag) => {
    const upper = tag.toUpperCase();
    for (const [value, expected] of [
      [`<${upper} title="x">text</${upper}>`, `&lt;${upper} title="x">text&lt;/${upper}>`],
      [`<${tag}/>`, `&lt;${tag}/>`],
      [`<${tag} />`, `&lt;${tag} />`],
    ] as const)
      expect(htmlView({ type: "html", value }, { ...github, flow: true })).toBe(expected);
  });

  it.each(["scripty", "iframex", "pre", "custom"])("does not filter ordinary %s", (tag) => {
    const value = `<${tag} title="<textarea>">x</${tag}>`;
    expect(htmlView({ type: "html", value }, github)).toBe(value);
    expect(htmlViewUncertain({ type: "html", value }, github)).toBe(false);
  });

  it("keeps the flow/inline filter distinction without filtering an assembled view again", () => {
    const node = { type: "html" as const, value: '<script data-x="<textarea>">' };
    expect(htmlView(node, { ...github, flow: true })).toBe('&lt;script data-x="&lt;textarea>">');
    expect(htmlView(node, github)).toBe('&lt;script data-x="<textarea>">');
    expect(htmlViewUncertain(node, github)).toBe(true);
    expect(htmlViewUncertain(node, { ...github, flow: true })).toBe(false);
    expect(htmlView({ type: "paragraph", children: [node] }, github)).toBe(
      '&lt;script data-x="<textarea>">',
    );
  });

  it("decodes text entities once and does not activate entity-escaped markup", () => {
    expect(htmlText(htmlTokens("&amp;lt;<em>A&amp;B&#x43;</em>"))).toBe("&lt;A&BC");
    expect(htmlHeadings(htmlTokens("&lt;h2&gt;literal&lt;/h2&gt;"))).toEqual([]);
  });

  it("keeps a filtered wrapper's literal id distinct from its allowed child id", () => {
    const fixture = fixtures.find(({ name }) => name === "ids")!;
    const workspace = createWorkspace({ "Note.md": fixture.source });
    expect(workspace.resolve("From.md", "Note.md#inner", "github").fragmentExists).toBe(true);
    expect(workspace.resolve("From.md", "Note.md#outer", "github").fragmentExists).toBe(false);
    expect(forgeAnchors(parse(fixture.source, "forgejo")).explicit.size).toBe(0);
    expect(forgeAnchors(parse(fixture.source, "gitea")).explicit.size).toBe(0);
  });

  it("keeps earlier explicit IDs and declines later IDs after unsupported inline attributes", () => {
    const source =
      '<a id="known">x</a>\n\n## A <script data-x="<textarea>">X</script> B\n\n<a id="later">x</a>\n';
    const workspace = createWorkspace({ "Note.md": source });
    expect(workspace.resolve("From.md", "Note.md#known", "github").fragmentExists).toBe(true);
    expect(workspace.resolve("From.md", "Note.md#later", "github")).toMatchObject({
      status: "unreadable",
      fragmentIncomplete: true,
    });
  });

  it.each(fixtures.filter(({ complete }) => !complete))(
    "protects the unsupported source suffix for $name",
    ({ source }) => {
      for (const newline of ["\n", "\r\n", "\r"])
        for (const mark of ["", String.fromCharCode(0xfeff)]) {
          const suffix = (source + "\nc  d\n").replaceAll("\n", newline);
          const input = mark + `before  text${newline}${newline}` + suffix;
          const expected = mark + `before text${newline}${newline}` + suffix;
          const result = format(input, { config });
          expect(result.output).toBe(expected);
          expect(result.diagnostics.filter(({ rule }) => rule.startsWith("engine/"))).toEqual([]);
          expect(format(result.output, { config }).output).toBe(result.output);
          expect(format(input, { config: { extends: [], dialect: "github" } }).output).toBe(input);
          expect(semanticFingerprint(parse(result.output, "github"))).toBe(
            semanticFingerprint(parse(input, "github")),
          );
        }
    },
  );

  it.each(fixtures.filter(({ complete }) => !complete))(
    "rejects a plugin edit inside the unsupported suffix for $name",
    ({ source: before }) => {
      const source = before + "\nc  d\n";
      const at = source.lastIndexOf("c  d");
      const plugin: Plugin = {
        name: "change",
        rules: {
          text: {
            kind: "style",
            description: "Change protected source",
            check: () => [
              { start: at, message: "Change", edit: { start: at, end: at + 4, text: "c d" } },
            ],
          },
        },
      };
      expect(
        format(source, {
          config: { extends: [], dialect: "github", rules: { "change/text": "warn" } },
          plugins: [plugin],
        }).output,
      ).toBe(source);
    },
  );

  it.each(fixtures.filter(({ complete }) => !complete))(
    "reports unsupported anchors as incomplete rather than missing for $name",
    ({ source, observedIds, knownIds }) => {
      const fragment = observedIds.find((id) => !knownIds.includes(id))!;
      const diagnostics = lint(`[link](Note.md#${fragment})\n`, {
        path: "From.md",
        config: { extends: [], dialect: "github", rules: { "links/valid": "error" } },
        workspace: createWorkspace({ "Note.md": source }),
      });
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]!.message).toContain("are not fully known for this renderer");
    },
  );

  it("keeps the serialized flow EOF boundary without appending text bytes", () => {
    for (const source of ["<div>\n<title\n", "<div>\n<title"]) {
      const node = parse(source, "github").tree.children[0]!;
      expect(node).toMatchObject({ type: "html", value: "<div>\n<title" });
      expect(htmlView(node, { ...github, flow: true })).toBe("<div>\n&lt;title");
      expect(htmlViewUncertain(node, { ...github, flow: true })).toBe(false);
      expect(htmlView(node)).toBe("<div>\n<title");
    }
    // An arbitrary inline lexeme has no implicit flow newline boundary.
    const inline = { type: "html" as const, value: "<title" };
    expect(htmlView(inline, github)).toBe("<title");
    expect(htmlView(inline, { ...github, flow: true })).toBe("&lt;title");
    expect(htmlView({ type: "html", value: "<title\n" }, { ...github, flow: true })).toBe(
      "&lt;title\n",
    );
  });

  it.each([
    ["<title/x>", "</title/x>"],
    ["<title/ >", "</title/ >"],
    ["<title\u000b>", "</title>"],
  ])("declines unsupported raw-flow %j without fabricating duplicate IDs", (open, close) => {
    const value = `${open}<h2>Child</h2>${close}`;
    const node = { type: "html" as const, value };
    expect(htmlView(node, { ...github, flow: true })).toContain(open);
    expect(htmlViewUncertain(node, { ...github, flow: true })).toBe(true);
    expect(htmlViewUncertain(node)).toBe(false);

    const source =
      `## Before\n\n<a id="known">x</a>\n\n<div>\n${value}\n</div>\n\n` +
      '## Child\n\n<a id="later">x</a>\n';
    const anchors = githubAnchors(parse(source, "github"));
    expect(anchors.complete).toBe(false);
    expect([...anchors.slugs]).toEqual(["before"]);
    expect([...anchors.explicit]).toEqual(["known"]);
    const workspace = createWorkspace({ "Note.md": source });
    for (const id of ["before", "known"])
      expect(workspace.resolve("From.md", `Note.md#${id}`, "github").fragmentExists).toBe(true);
    for (const id of ["child", "child-1", "later"])
      expect(workspace.resolve("From.md", `Note.md#${id}`, "github")).toMatchObject({
        status: "unreadable",
        fragmentIncomplete: true,
      });
  });

  it.each([
    ["<title>", "</title>"],
    ["<title/>", "</title>"],
    ["<title />", "</title>"],
    ["<title-suffix>", "</title-suffix>"],
  ])("keeps the supported raw-flow %j control complete", (open, close) => {
    const source = `<div>\n${open}<h2>Control</h2>${close}\n</div>\n\n## Control\n`;
    const node = parse(source, "github").tree.children[0]!;
    expect(htmlViewUncertain(node, { ...github, flow: true })).toBe(false);
    const anchors = githubAnchors(parse(source, "github"));
    expect(anchors.complete).toBe(true);
    expect([...anchors.slugs]).toEqual(["control", "control-1"]);
  });
});
