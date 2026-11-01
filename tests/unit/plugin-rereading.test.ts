import type { Extension as MdastExtension } from "mdast-util-from-markdown";
import type { Code, Construct, Extension, State } from "micromark-util-types";
import { describe, expect, it } from "vitest";
import { builtInRules, format, lint, parse, semanticFingerprint } from "../../src/index.js";
import type { Config, Plugin } from "../../src/index.js";

// Rules that read changed text again read it with the document's plugins (#752).

const lineEnding = (code: Code) => code === -5 || code === -4 || code === -3;
/** A line that starts with `@@` is a block of its own, which ends a paragraph above it. */
const atLine: Construct = {
  name: "atLine",
  tokenize(effects, ok, nok) {
    const rest: State = (code) => {
      if (code === null || lineEnding(code)) {
        effects.exit("atLine" as never);
        return ok(code);
      }
      effects.consume(code);
      return rest;
    };
    const second: State = (code) => {
      if (code !== 64) return nok(code);
      effects.consume(code);
      return rest;
    };
    return (code) => {
      if (code !== 64) return nok(code);
      effects.enter("atLine" as never);
      effects.consume(code);
      return second;
    };
  },
};
const atLineTree: MdastExtension = {
  enter: {
    atLine(token) {
      this.enter({ type: "atLine", value: "" } as never, token);
    },
  },
  exit: {
    atLine(token) {
      (this.stack.at(-1) as unknown as { value: string }).value = this.sliceSerialize(token);
      this.exit(token);
    },
  },
};
const atLines: Plugin = {
  name: "at-lines",
  syntax: { micromark: { flow: { 64: atLine } } satisfies Extension, mdast: atLineTree },
};
/** No link reference definitions: `[a]: b` is paragraph text. */
const noDefinitions: Plugin = {
  name: "no-definitions",
  syntax: { micromark: { disable: { null: ["definition"] } }, mdast: {} },
};
/** No emphasis or strong emphasis at all. */
const noEmphasis: Plugin = {
  name: "no-emphasis",
  syntax: { micromark: { disable: { null: ["attention"] } }, mdast: {} },
};
const only = (rule: string, options?: Record<string, unknown>): Config => ({
  extends: [],
  dialect: "github",
  rules: { [rule]: options ? ["warn", options] : "warn" },
});

describe("rules that read changed text again use the document's plugins (#752)", () => {
  it.each(["\n", "\r\n", "\r"])("keeps plugin block markers with %j line endings (#777)", (eol) => {
    const original = "a ".repeat(39) + "@@x b";
    const safe = "ordinary ".repeat(16).trimEnd();
    for (const dialect of [
      "commonmark",
      "github",
      "forgejo",
      "gitea",
      "obsidian",
      "vitepress",
    ] as const) {
      for (const prefix of ["", "> ", "- ", "- > "]) {
        // Container prefixes consume width; keep @@x at the actual wrap edge.
        const paragraph = "a ".repeat(39 - prefix.length / 2) + "@@x b";
        const source = `${prefix}${paragraph}${eol}${eol}${safe}${eol}`;
        const config: Config = { extends: [], dialect, rules: { "style/wrap": "warn" } };
        const options = {
          plugins: [atLines],
          config,
          workspace: { resolve: () => ({ status: "external" as const }), strictLineBreaks: true },
        };
        const result = format(source, options);
        expect(result.diagnostics, dialect + prefix).toEqual([]);
        expect(result.output.startsWith(prefix + paragraph + eol), dialect + prefix).toBe(true);
        expect(result.output).not.toBe(source);
        expect(semanticFingerprint(parse(result.output, dialect, "document.md", [atLines]))).toBe(
          semanticFingerprint(parse(source, dialect, "document.md", [atLines])),
        );
        expect(format(result.output, options).output).toBe(result.output);
      }
    }
    // Here the four-column prefix moves the break before the last "a", so
    // @@x remains inside the line. This is safe and must still wrap.
    const safeContainer = `- > ${original}${eol}`;
    const safeResult = format(safeContainer, { plugins: [atLines], config: only("style/wrap") });
    expect(safeResult.diagnostics).toEqual([]);
    expect(safeResult.output).toContain(`${eol}  > a @@x b`);
    const source = original + eol;
    const config = only("style/wrap", { reportUnreflowed: true });
    expect(lint(source, { plugins: [atLines], config })).toEqual([
      expect.objectContaining({
        rule: "style/wrap",
        message: "Paragraph not reflowed: syntax plugin block structure (width 80 columns).",
      }),
    ]);
    expect(format(source, { config: only("style/wrap") }).output).toContain(`${eol}@@x b`);
  });
  it("rereads only changed candidates when syntax plugins are present (#777)", () => {
    let reads = 0;
    const plugin: Plugin = {
      name: "count-reads",
      syntax: {
        micromark: {},
        mdast: {
          transforms: [
            (tree) => {
              reads++;
              return tree;
            },
          ],
        },
      },
    };
    const wide = "word ".repeat(30).trimEnd();
    const document = parse(`${wide}\n\nShort.\n\n${wide}\n`, "commonmark", "document.md", [plugin]);
    reads = 0;
    const findings = builtInRules["style/wrap"]!.check({ document, options: { width: 40 } });
    expect(findings).toHaveLength(2);
    expect(reads).toBe(2);
    const normal = parse(wide, "commonmark");
    const rulesOnly = parse(wide, "commonmark", "document.md", [{ name: "rules-only", rules: {} }]);
    expect(
      builtInRules["style/wrap"]!.check({ document: rulesOnly, options: { width: 40 } }),
    ).toEqual(builtInRules["style/wrap"]!.check({ document: normal, options: { width: 40 } }));
  });
  it("style/wrap breaks after a definition-like start that the plugin reads as text", () => {
    const source = "[a]: b " + "x".repeat(80) + "\n";
    const config = only("style/wrap");
    const result = format(source, { plugins: [noDefinitions], config });
    expect(result.output).toBe("[a]: b\n" + "x".repeat(80) + "\n");
    expect(result.diagnostics.filter(({ rule }) => rule.startsWith("engine/"))).toEqual([]);
    // Without the plugin, that break would make a definition, so the words stay.
    expect(format(source, { config }).output).toBe(source);
  });
  it("content/emphasis-spacing reports nothing where the plugin reads no emphasis", () => {
    const source = "Here is some ** bold ** text.\n";
    const config = only("content/emphasis-spacing");
    expect(lint(source, { plugins: [noEmphasis], config })).toEqual([]);
    expect(lint(source, { config })).toHaveLength(1);
  });
  it("style/line-ending changes endings around a plugin's block", () => {
    const source = "@@a\r\nb\r\n";
    const result = format(source, { plugins: [atLines], config: only("style/line-ending") });
    expect(result.output).toBe("@@a\nb\n");
    expect(result.diagnostics).toEqual([]);
  });
  it("structure/heading-template reads its headings as the document is read", () => {
    const source = "# *Intro*\n";
    const config = only("structure/heading-template", { headings: ["# *Intro*"] });
    expect(lint(source, { plugins: [noEmphasis], config })).toEqual([]);
    expect(lint("# *Intro*\n", { config })).toEqual([]);
    expect(lint("# Intro\n", { plugins: [noEmphasis], config }).map(({ rule }) => rule)).toEqual([
      "structure/heading-template",
    ]);
  });
});
