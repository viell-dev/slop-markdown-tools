import { describe, expect, it } from "vitest";
import { createWorkspace, format, lint, parse, semanticFingerprint } from "../../src/index.js";
import type { Config, Dialect } from "../../src/index.js";

const table = "| c | d |\n| - | - |\n| e | f |\n";
const bodies = [
  "[a]: missing.md\n",
  "[a]: missing.md\ntext\n",
  "[a]: missing.md\n[c]: other.md\n",
  "[a]: missing.md\n[c]: other.md\ntext\n",
];
const containers = [
  (body: string) => body,
  (body: string) => body.replace(/^/gm, "> ").trimEnd() + "\n",
  (body: string) => "- " + body.trimEnd().replaceAll("\n", "\n  ") + "\n",
];
const config = (dialect: Dialect, rule: string): Config => ({
  extends: [],
  dialect,
  rules: { [rule]: "warn" },
});

describe("GitHub definitions in content interrupted by tables (#732)", () => {
  for (const newline of ["\n", "\r\n"])
    for (const [index, container] of containers.entries())
      for (const body of bodies) {
        const source = ("See [x][a].\n\n" + container(body + table)).replaceAll("\n", newline);
        const name = `${index} ${JSON.stringify(body)} ${JSON.stringify(newline)}`;
        it(`reports undefined references: ${name}`, () => {
          expect(
            lint(source, { config: config("github", "links/undefined-reference") }),
          ).toHaveLength(1);
        });
        it(`does not validate visible definition text: ${name}`, () => {
          const workspace = createWorkspace({ "document.md": source }, { dialect: "github" });
          expect(lint(source, { workspace, config: config("github", "links/valid") })).toEqual([]);
        });
        it(`does not report visible text as an unused definition: ${name}`, () => {
          expect(
            lint(source.replace("See [x][a].", "Text."), {
              config: config("github", "links/unused-definition"),
            }),
          ).toEqual([]);
        });
        it(`preserves meaning and converges: ${name}`, () => {
          const options = { config: { extends: ["recommended", "github"] } };
          const result = format(source, options);
          expect(result.diagnostics.some((d) => d.rule === "engine/unsafe-format")).toBe(false);
          expect(semanticFingerprint(parse(result.output, "github"))).toBe(
            semanticFingerprint(parse(source, "github")),
          );
          expect(format(result.output, options).output).toBe(result.output);
          expect(result.output).not.toMatch(/missing\.md\r?\n\r?\n/);
        });
      }
  it.each(["commonmark", "forgejo", "gitea", "obsidian", "vitepress"] as const)(
    "retains definitions in %s",
    (dialect) => {
      for (const body of bodies)
        for (const container of containers) {
          const source = "See [x][a].\n\n" + container(body + table);
          expect(lint(source, { config: config(dialect, "links/undefined-reference") })).toEqual(
            [],
          );
          expect(
            lint(source, {
              config: config(dialect, "links/valid"),
              workspace: createWorkspace({ "document.md": source }, { dialect }),
            }).length,
          ).toBeGreaterThan(0);
          expect(
            lint(source.replace("See [x][a].", "Text."), {
              config: config(dialect, "links/unused-definition"),
            }).length,
          ).toBeGreaterThan(0);
        }
    },
  );
  it("retains definitions without an interrupting table or with a blank separator", () => {
    for (const body of bodies)
      for (const suffix of ["", "\n" + table]) {
        const source = "See [x][a].\n\n" + body + suffix;
        expect(lint(source, { config: config("github", "links/undefined-reference") })).toEqual([]);
        expect(
          lint(source.replace("See [x][a].", "Text."), {
            config: config("github", "links/unused-definition"),
          }).length,
        ).toBeGreaterThan(0);
        expect(
          lint(source, {
            config: config("github", "links/valid"),
            workspace: createWorkspace({ "document.md": source }, { dialect: "github" }),
          }).length,
        ).toBeGreaterThan(0);
      }
  });
  it("uses a later real definition and its heading text for workspace anchors", () => {
    const source = "# [x][a]\n\n[a]: missing.md\n" + table + "\n[a]: real.md\n";
    const workspace = createWorkspace(
      { "document.md": source, "real.md": "" },
      { dialect: "github" },
    );
    expect(lint(source, { workspace, config: config("github", "links/valid") })).toEqual([]);
    expect(
      lint(source, { workspace, config: config("github", "links/unused-definition") }),
    ).toEqual([]);
    expect(workspace.resolve("other.md", "document.md#x", "github").fragmentExists).toBe(true);
  });
  it("indexes HTML anchors in visible definition text", () => {
    const source = '[a]: /b "<a id=visible></a>"\n' + table;
    const workspace = createWorkspace({ "target.md": source }, { dialect: "github" });
    expect(workspace.resolve("other.md", "target.md#visible", "github").fragmentExists).toBe(true);
  });
});
