import { describe, expect, it } from "vitest";
import { HtmlRenderer, Parser } from "commonmark";
import MarkdownIt from "markdown-it";
import type { Link } from "mdast";
import { createWorkspace, format, lint, parse, semanticFingerprint } from "../../src/index.js";
import type { Dialect, Plugin } from "../../src/index.js";
import { verifyReferenceConversion } from "../../src/core/reference-conversion.js";
import { range } from "../../src/syntax/parse.js";
import { walk } from "../../src/syntax/walk.js";
import { formatted, only, refusals } from "../support/rules.js";
import { normalizeHtml } from "../../scripts/rendering.mjs";

const dialects: Dialect[] = ["commonmark", "github", "forgejo", "gitea", "obsidian", "vitepress"];
const rule = "links/allowed-notation";
const rules = { [rule]: ["warn", { inline: false, fixTo: "full" }] } as const;
const render = (source: string) => [
  new HtmlRenderer().render(new Parser().parse(source)),
  new MarkdownIt("commonmark").render(source),
];

describe("explicit inline-to-reference conversion", () => {
  it.each(dialects)("converts links and images with titles, deterministically (%s)", (dialect) => {
    const source =
      'Read [the *guide*](https://example.com/a_(b) "A &amp; B") and ![a *picture*](https://example.com/p.png "Picture").\n';
    const output = formatted(source, only(rules, dialect));
    expect(output).toBe(
      'Read [the *guide*][mdrefine-link-1] and ![a *picture*][mdrefine-link-2].\n\n[mdrefine-link-1]: https://example.com/a_(b) "A &amp; B"\n[mdrefine-link-2]: https://example.com/p.png "Picture"\n',
    );
    expect(render(output)).toEqual(render(source));
    expect(lint(output, { config: only(rules, dialect) })).toEqual([]);
    expect(semanticFingerprint(parse(output, dialect))).not.toBe(
      semanticFingerprint(parse(source, dialect)),
    );
  });

  it("preserves existing behavior without the new option and when disabled", () => {
    const source = "[guide](/a)\n";
    expect(formatted(source, only({ [rule]: ["warn", { inline: false }] }))).toBe(source);
    expect(formatted(source, only({ [rule]: "off" }))).toBe(source);
    expect(
      formatted(
        "[https://example.com](https://example.com)\n",
        only({ [rule]: ["warn", { urlInline: false }] }),
      ),
    ).toBe("<https://example.com>\n");
    expect(formatted(source, only({ [rule]: ["warn", { fixTo: "full" }] }))).toBe(source);
  });

  it("uses the explicit target for a disallowed URL-as-text form", () => {
    expect(
      formatted(
        "[https://example.com](https://example.com)\n",
        only({ [rule]: ["warn", { urlInline: false, fixTo: "full" }] }),
      ),
    ).toContain("[https://example.com][mdrefine-link-1]");
  });

  it.each([{ fixTo: "inline" }, { fixTo: true }, { fixTo: "full", full: false }])(
    "rejects contradictory or unsupported options: %j",
    (options) => {
      expect(() => lint("", { config: only({ [rule]: ["warn", options] }) })).toThrow(
        "Invalid options",
      );
    },
  );

  it("shares only identical destinations and titles, including explicit empty titles", () => {
    const source = '[a](/url) [b](/url) ![c](/url) [d](/url "") [e](/url "Title")\n';
    const output = formatted(source, only(rules));
    expect(output).toBe(
      '[a][mdrefine-link-1] [b][mdrefine-link-1] ![c][mdrefine-link-1] [d][mdrefine-link-2] [e][mdrefine-link-3]\n\n[mdrefine-link-1]: /url\n[mdrefine-link-2]: /url ""\n[mdrefine-link-3]: /url "Title"\n',
    );
    expect(render(output)).toEqual(render(source));
  });

  it("reuses only unique, already-used definitions and keeps every authored definition", () => {
    const source =
      '[existing][Straße MD] [new](/url "Title") [unused](/other) [shadowed](/first) [comment](# "note")\n\n[Straße MD]: /url "Title"\n[unused]: /other\n[DUP]: /first\n[dup]: /second\n[//]: # "note"\n';
    const output = formatted(source, only(rules));
    expect(output).toContain(
      "[existing][Straße MD] [new][Straße MD] [unused][mdrefine-link-1] [shadowed][mdrefine-link-2] [comment][mdrefine-link-3]",
    );
    expect(output).toContain(source.slice(source.indexOf("[Straße MD]:")));
    expect(render(output)).toEqual(render(source));
  });

  it("reserves undefined, differently cased and Unicode-folded generated labels", () => {
    const source =
      "Keep [MDREFINE-LINK-1], [mdrefine-linK-2] and [mdrefine-link-3][] literal. [guide](/url)\n";
    const output = formatted(source, only(rules));
    expect(output).toContain("[guide][mdrefine-link-4]");
    expect(render(output)).toEqual(render(source));
  });

  it.each(["\n", "\r\n", "\r"])("keeps source line endings %j", (newline) => {
    const source = `[a](/url)${newline}`;
    expect(formatted(source, only(rules))).toBe(
      `[a][mdrefine-link-1]${newline}${newline}[mdrefine-link-1]: /url${newline}`,
    );
  });

  it("retains byte order marks and handles many distinct destinations", () => {
    const source =
      "\uFEFF" +
      Array.from({ length: 150 }, (_, index) => `[${index}](https://example.com/${index})`).join(
        "\n",
      ) +
      "\n";
    const output = formatted(source, only(rules));
    expect(output.startsWith("\uFEFF[0][mdrefine-link-1]")).toBe(true);
    expect(output).toContain("[149][mdrefine-link-150]");
    expect(output.match(/^\[mdrefine-link-\d+\]:/gm)).toHaveLength(150);
  });

  it.each([
    "[a](<>)\n",
    "[a](<a b.md> 'A \\'quote\\'')\n",
    "[a \\] with `]` and ![picture](/p)](/url)\n",
    "> [a](/url)\n\n- [b](/other)\n",
    "| Name | Link |\n| --- | --- |\n| A | [a](/url) |\n",
  ])("preserves independent rendering for %j", (source) => {
    const output = formatted(source, only(rules));
    expect(output).not.toBe(source);
    expect(render(output)).toEqual(render(source));
  });

  it.each([
    "[a](/url)\n\n```\nopen fence\n",
    "[a](/url)\n\n<!-- open comment\n",
    "[a](\n/url\n'Title'\n)\n",
    '[a](/url\t"Title")\n',
    '![a](/url\t"Title")\n',
  ])("reports without fixing when insertion or serialization is unsafe: %j", (source) => {
    const result = format(source, { config: only(rules) });
    expect(result.output).toBe(source);
    expect(result.diagnostics.some((item) => item.rule === rule)).toBe(true);
    expect(refusals(result)).toEqual([]);
  });

  it.each([
    "javascript:alert(1)",
    "file:///etc/example",
    "data:text/plain,hello",
    "vbscript:example",
    "data:image/png;base64,aGVsbG8=",
  ])("keeps a resource with host-dependent scheme policy: %s", (url) => {
    const source = `[a](${url})\n`;
    const output = formatted(source, only(rules));
    expect(output).toBe(source);
    expect(render(output)).toEqual(render(source));
  });

  it("keeps existing reference forms, autolinks, code and wikilinks", () => {
    const source = "[a][r] [r][] [r] <https://example.com> `![x](/y)`\n\n[r]: /url\n";
    expect(formatted(source, only(rules))).toBe(source);
    expect(formatted("[[Note|label]]\n", only(rules, "obsidian"))).toBe("[[Note|label]]\n");
  });

  it.each(['[r]:\t/url "Title"', '[r]: /url\t"Title"'])(
    "keeps a tabbed definition without reusing it: %s",
    (definition) => {
      const source = `[existing][r] [new](/url "Title")\n\n${definition}\n`;
      const output = formatted(source, only(rules));
      expect(output).toContain("[existing][r] [new][mdrefine-link-1]");
      expect(output).toContain(definition);
      expect(render(output)).toEqual(render(source));
    },
  );

  it("respects suppression on each link and on the insertion point", () => {
    const source =
      "<!-- mdrefine-disable-next-line links/allowed-notation -->\n[keep](/keep)\n\n[convert](/convert)\n";
    const output = formatted(source, only(rules));
    expect(output).toContain("[keep](/keep)");
    expect(output).toContain("[convert][mdrefine-link-1]");
    const disabledEnd = "[a](/url)\n\n<!-- mdrefine-disable links/allowed-notation -->\n";
    expect(formatted(disabledEnd, only(rules))).toBe(disabledEnd);
  });

  it("applies a conversion and insertion atomically within selected ranges", () => {
    const source = "[a](/url)\n\nUntouched text.\n";
    expect(formatted(source, only(rules), { ranges: [{ start: 0, end: 8 }] })).toBe(source);
    expect(
      formatted(source, only(rules), { ranges: [{ start: 0, end: source.length }] }),
    ).toContain("[a][mdrefine-link-1]");
    const reuse = "[a](/url)\n\n[r]\n\n[r]: /url\n";
    expect(formatted(reuse, only(rules), { ranges: [{ start: 0, end: 8 }] })).toBe(
      "[a][r]\n\n[r]\n\n[r]: /url\n",
    );
  });

  it("converges with wrapping, title, definition-spacing and link path rules", () => {
    const source =
      "Some long prose with [the *guide*](https://example.com/path 'Title') and more long prose to wrap.\n";
    const config = only({
      ...rules,
      "style/wrap": ["warn", { width: 35 }],
      "style/emphasis": ["warn", { marker: "_" }],
      "style/link-title": ["warn", { delimiter: "double" }],
      "style/definition-spacing": "warn",
      "links/path": "warn",
    });
    const output = formatted(source, config);
    expect(output).toMatch(/\[the\s+_guide_\]\[mdrefine-link-1\]/);
    expect(render(output).map(normalizeHtml)).toEqual(render(source).map(normalizeHtml));
  });

  it("converts after a verified local path rewrite", () => {
    const source = "[guide](docs/guide.md#setup)\n";
    const workspace = createWorkspace({ "README.md": source, "docs/guide.md": "# Setup\n" });
    const output = formatted(
      source,
      only({ ...rules, "links/path": ["warn", { style: "relative", leadingDot: true }] }, "github"),
      { path: "README.md", workspace },
    );
    expect(output).toBe("[guide][mdrefine-link-1]\n\n[mdrefine-link-1]: ./docs/guide.md#setup\n");
    expect(workspace.resolve("README.md", "./docs/guide.md#setup", "github").fragmentExists).toBe(
      true,
    );
  });

  it.each(["forgejo", "gitea"] as const)(
    "keeps anchor-sensitive headings while converting the body (%s)",
    (dialect) => {
      const heading = '# [The guide](https://example.com/setup "Setup")\n';
      const source = heading + '\nRead [the guide](https://example.com/setup "Setup").\n';
      const output = formatted(source, only(rules, dialect));
      expect(output.startsWith(heading)).toBe(true);
      expect(output).toContain("Read [the guide][mdrefine-link-1].");
      expect(render(output)).toEqual(render(source));
      const custom = '# [The guide](https://example.com/setup "Setup") {#guide}\n';
      expect(formatted(custom, only(rules, dialect))).toContain(
        "# [The guide][mdrefine-link-1] {#guide}",
      );
    },
  );

  it("still refuses a plugin's unrelated definition edit while conversion is enabled", () => {
    const source = "[a](/url) [existing][r]\n\n[r]: /original\n";
    const plugin: Plugin = {
      name: "attack",
      rules: {
        change: {
          kind: "style",
          description: "Change a definition",
          check: ({ document }) => {
            const start = document.source.indexOf("/original");
            return start < 0
              ? []
              : [{ start, message: "Change", edit: { start, end: start + 9, text: "/changed" } }];
          },
        },
      },
    };
    const result = format(source, {
      config: only({ ...rules, "attack/change": "warn" }),
      plugins: [plugin],
    });
    expect(result.output).toContain("[a][mdrefine-link-1]");
    expect(result.output).toContain("[r]: /original");
    expect(result.output).not.toContain("/changed");
    expect(refusals(result)).toHaveLength(1);
  });
});

describe("scoped reference-conversion proof", () => {
  function proof({
    prefix = "",
    destination = "/url",
    extra = "",
    title = "",
    resource = "/url",
    extraInline = {},
    extraReference = {},
  } = {}) {
    const source = `${prefix}[a](${resource})\n`;
    const candidate = `${prefix}[a][r]\n\n[r]: ${destination}${title}\n${extra}`;
    const before = parse(source, "commonmark");
    let node: Link | undefined;
    walk(before.tree, "link", (found) => {
      node = found;
    });
    if (!node) throw new Error("Missing test link");
    Object.assign(node, extraInline);
    const after = parse(candidate, "commonmark");
    walk(after.tree, "linkReference", (reference) => Object.assign(reference, extraReference));
    return verifyReferenceConversion(
      before,
      after,
      [
        {
          node,
          edit: { start: range(node)[0], end: range(node)[1], text: "[a][r]" },
          identifier: "r",
          at: prefix.length,
        },
      ],
      [{ identifier: "r", text: `[r]: ${destination}${title}`, at: candidate.indexOf("[r]:") }],
    );
  }
  it("accepts the exact transformation", () => {
    expect(proof()).toBe(true);
  });
  it("rejects activation of an untouched undefined shortcut", () => {
    expect(proof({ prefix: "Keep [r] literal. " })).toBe(false);
  });
  it("rejects changed destinations and title presence", () => {
    expect(proof({ destination: "/other" })).toBe(false);
    expect(proof({ title: ' ""' })).toBe(false);
  });
  it("rejects an unapproved definition", () => {
    expect(proof({ extra: "[extra]: /extra\n" })).toBe(false);
  });
  it("independently refuses unsupported resources even when the parsed target agrees", () => {
    expect(proof({ resource: "javascript:alert(1)", destination: "javascript:alert(1)" })).toBe(
      false,
    );
    expect(proof({ resource: '/url\t"Title"', title: ' "Title"' })).toBe(false);
  });
  it.each([{ extensionMeaning: "changed" }, { url: "/other" }, { title: "Other" }])(
    "does not erase a reference extension field: %j",
    (extraReference) => {
      expect(proof({ extraReference })).toBe(false);
    },
  );
  it("preserves matching extension fields", () => {
    expect(
      proof({
        extraInline: { extensionMeaning: "same" },
        extraReference: { extensionMeaning: "same" },
      }),
    ).toBe(true);
  });
});
