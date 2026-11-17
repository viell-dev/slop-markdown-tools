import { describe, expect, it } from "vitest";
import { format, parse, range } from "../../src/index.js";
import type { DialectName, Plugin } from "../../src/index.js";
import { rendererProtections } from "../../src/syntax/renderer-protections.js";
import { forgeBoundaryFixtures, forgeFrontMatterFixtures } from "../fixtures/renderers/forges.mjs";
import { formatted } from "../support/engine.js";

const protectedSources = (source: string, dialect: DialectName) => {
  const { tableText, boundaryText } = rendererProtections(parse(source, dialect));
  return [...tableText, ...boundaryText].map((node) => source.slice(...range(node)));
};
const rewrite = (before: string, after: string): Plugin => ({
  name: "probe",
  rules: {
    rewrite: {
      kind: "style",
      phase: "document",
      description: "Change a native boundary hidden from the primary tree",
      check: ({ document: { source } }) => {
        const start = source.indexOf(before);
        return start < 0
          ? []
          : [
              {
                start,
                message: "Rewrite",
                edit: { start, end: start + before.length, text: after },
              },
            ];
      },
    },
  },
});

describe.each(["forgejo", "gitea"] as const)("%s native paragraph boundaries", (dialect) => {
  it.each(["\n", "\r\n", "\r"])(
    "keeps table continuation and clips at an interrupting list (%j)",
    (newline) => {
      const source = ["| Step |", "| --- |", "2) Continue", "1) Outside *text*", ""].join(newline);
      expect(protectedSources(source, dialect)).toEqual([
        ["| Step |", "| --- |", "2) Continue"].join(newline),
      ]);
      const output = formatted(source, { config: { extends: ["recommended", dialect] } });
      expect(output).toContain(["| Step |", "| --- |", "2) Continue"].join(newline));
      // The ordered-list rule proposes one edit for both primary items, so
      // its marker change is withheld as a unit. Independent inline edits work.
      expect(output).toContain("1) Outside _text_");
    },
  );

  it.each([
    "1) Outside",
    "01. Outside",
    "- Outside",
    "# Outside",
    "> Outside",
    "~~~",
    "```js",
    "<div>",
    "",
    "---",
  ])("does not absorb a paragraph interruption: %j", (stop) => {
    const prefix = "| Step |\n| --- |\n2) Continue";
    expect(protectedSources(`${prefix}\n${stop}\n`, dialect)).toEqual([prefix]);
    expect(protectedSources(`| Step |\n| --- |\n${stop}\n`, dialect)).toEqual([]);
  });

  it("retains deeply indented apparent markers and empty list markers as native rows", () => {
    for (const row of ["    1) Still a row", "\t1) Still a row", "3) Another row", "1)", "+"]) {
      const source = `| Step |\n| --- |\n2) Continue\n${row}\n`;
      expect(protectedSources(source, dialect)).toEqual([source.trimEnd()]);
    }
  });

  it.each(["style/block-spacing", "style/ordered-list", "style/wrap"])(
    "protects continued rows from %s alone",
    (rule) => {
      const source = "Number | Description\n--- | ---\n2) | Second entry\nThird | More text\n";
      expect(
        formatted(source, { config: { dialect, extends: [], rules: { [rule]: "warn" } } }),
      ).toBe(source);
    },
  );

  it("protects the hidden table suffix while keeping preceding and following prose editable", () => {
    const source = "> *Intro*\n| Name |\n| --- |\n| Value |\n\nOutside *text*.\n";
    expect(protectedSources(source, dialect)).toEqual(["\n| Name |\n| --- |\n| Value |"]);
    const output = formatted(source, { config: { extends: ["recommended", dialect] } });
    expect(output).toContain("| Name |\n| --- |\n| Value |");
    expect(output).toContain("_Intro_");
    expect(output).toContain("Outside _text_.");
  });

  it.each(["\n", "\r\n", "\r"])(
    "retains a URL-adjacent single backslash and separator (%j)",
    (newline) => {
      const source = `Visit www.example.com\\${newline}Then continue.${newline}`;
      expect(protectedSources(source, dialect)).toEqual([`\\${newline}`]);
      expect(formatted(source, { config: { extends: ["recommended", dialect] } })).toBe(source);
    },
  );

  it("does not freeze URL backslash controls or ordinary tables and inline code", () => {
    for (const source of [
      "Visit www.example.com\\\\\nThen continue.\n",
      "Visit www.example.com\\\\\\\nThen continue.\n",
      "Visit www.example.com\\ \nThen continue.\n",
      "Visit https://example.com/a\\b\nThen continue.\n",
      "Visit <https://example.com>\\\nThen continue.\n",
      "Write help@example.com\\\nThen continue.\n",
      "`www.example.com\\\ncontinued`\n",
      "| Name |\n| --- |\n| Value |\n",
      "> Intro\n| One | Two |\n| --- |\n",
    ])
      expect(protectedSources(source, dialect), source).toEqual([]);
  });

  it.each([
    ["| Step |\n| --- |\n2) Continue\n", "2)", "2."],
    ["> Intro\n| Name |\n| --- |\n| Value |\n", "Intro\n", "Intro "],
    ["Visit www.example.com\\\nThen continue.\n", "\\\n", "\\ "],
  ])("rejects a plugin edit that changes native structure in %j", (source, before, after) => {
    const result = format(source, {
      plugins: [rewrite(before, after)],
      config: { dialect, extends: [], rules: { "probe/rewrite": "warn" } },
    });
    expect(result.output).toBe(source);
    expect(result.diagnostics).toEqual([]);
  });

  it.each(forgeBoundaryFixtures)("is idempotent without safety fallbacks: $name", ({ source }) => {
    formatted(source, { config: { extends: ["recommended", dialect] } });
  });
});

it.each(["commonmark", "github", "vitepress"] as const)(
  "leaves the other %s reading alone",
  (dialect) => {
    for (const { source } of forgeBoundaryFixtures)
      expect(protectedSources(source, dialect)).toEqual([]);
  },
);

describe.each(["forgejo", "codeberg", "gitea"] as const)(
  "%s native metadata envelopes",
  (dialect) => {
    it.each(forgeFrontMatterFixtures)(
      "preserves the envelope and formats its body: $name",
      ({ source }) => {
        const envelope = source.slice(0, source.indexOf("\n\nBody"));
        const output = formatted(source, { config: { extends: ["recommended", dialect] } });
        expect(output).toBe(`${envelope}\n\nBody _text_.\n`);
        expect(parse(source, dialect).tree.children[0]?.type).not.toBe("yaml");
      },
    );

    it.each(["\n", "\r\n"])("protects through only the first closer (%j)", (newline) => {
      const source = ["----", "title: *Example*", " ---", "", "Body *text*.", "", "----", ""].join(
        newline,
      );
      expect(protectedSources(source, dialect)).toEqual([
        ["----", "title: *Example*", " ---"].join(newline),
      ]);
      expect(formatted(source, { config: { extends: ["recommended", dialect] } })).toContain(
        "Body _text_.",
      );
    });

    it("leaves parser-owned front matter on its existing path", () => {
      const source = "---\ntitle: *Example*\n---  \n\nBody *text*.\n";
      expect(protectedSources(source, dialect)).toEqual([]);
      expect(formatted(source, { config: { extends: ["recommended", dialect] } })).toBe(
        source.replace("Body *text*", "Body _text_"),
      );
    });

    it.each([
      "----\ntitle: *Example*\n",
      "\n----\ntitle: Example\n----\n",
      "\t----\ntitle: Example\n----\n",
      "\u00a0---\ntitle: Example\n----\n",
    ])("does not protect a non-envelope: %j", (source) => {
      expect(protectedSources(source, dialect)).toEqual([]);
    });

    it("rejects plugin edits inside the envelope", () => {
      const source = "----\ntitle: Example\n----\n";
      expect(
        format(source, {
          plugins: [rewrite("Example", "Changed")],
          config: { dialect, extends: [], rules: { "probe/rewrite": "warn" } },
        }).output,
      ).toBe(source);
    });
  },
);

it.each(["commonmark", "github", "obsidian", "vitepress"] as const)(
  "does not add forge envelopes in %s",
  (dialect) => {
    const source = "---\ntitle: Example\n----\n\nBody text.\n";
    expect(protectedSources(source, dialect)).toEqual([]);
    expect(formatted(source, { config: { extends: ["recommended"], dialect } })).toBe(
      dialect === "obsidian" || dialect === "vitepress"
        ? source
        : "---\n\n## title: Example\n\nBody text.\n",
    );
  },
);
