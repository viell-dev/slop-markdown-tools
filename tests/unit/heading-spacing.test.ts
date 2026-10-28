import { describe, expect, it } from "vitest";
import {
  createWorkspace,
  dialects,
  format,
  lint,
  parse,
  semanticFingerprint,
} from "../../src/index.js";
import { formatted, only } from "../support/rules.js";

describe("style/heading hash spacing (#676, #678)", () => {
  it.each(dialects)(
    "normalizes separators without changing meaning or anchors on %s",
    (dialect) => {
      for (const newline of ["\n", "\r\n", "\r"]) {
        for (const closing of ["remove", "keep"] as const) {
          const config = only({ "style/heading": ["warn", { closing }] }, dialect);
          for (const [source, expected] of [
            ["#  Heading", "# Heading"],
            ["##\tHeading", "## Heading"],
            ["#  Heading  #", closing === "keep" ? "# Heading #" : "# Heading"],
            ["###\tHeading\t###", closing === "keep" ? "### Heading ###" : "### Heading"],
            ["#  C#", "# C#"],
            ["#  Text \\#", "# Text \\#"],
            ["#  #tag", "# #tag"],
            ["#  Text #tag", "# Text #tag"],
            ["> #  Quoted  #", closing === "keep" ? "> # Quoted #" : "> # Quoted"],
            ["- #  Listed  #", closing === "keep" ? "- # Listed #" : "- # Listed"],
            ["  #  Indented", "  # Indented"],
            ["#", "#"],
            ["##  \t", "##"],
            ["#  #", closing === "keep" ? "# #" : "#"],
          ]) {
            const input = source + newline;
            const output = formatted(input, config);
            expect(output).toBe(expected + newline);
            expect(semanticFingerprint(parse(output, dialect))).toBe(
              semanticFingerprint(parse(input, dialect)),
            );
            expect(format(input, { config: only({}, dialect) }).output).toBe(input);
          }
          const source = `#  Heading  #${newline}`;
          const output = formatted(source, config);
          const resolve = (text: string) =>
            createWorkspace({ "Doc.md": text }, { dialect }).resolve(
              "Other.md",
              "Doc.md#heading",
              dialect,
            );
          expect(resolve(output)).toEqual(resolve(source));
          expect(resolve(output)?.fragmentExists).toBe(true);
        }
      }
    },
  );

  it.each(["forgejo", "gitea"] as const)(
    "retains closing hashes after %s attributes",
    (dialect) => {
      for (const closing of ["remove", "keep"] as const) {
        const config = only({ "style/heading": ["warn", { closing }] }, dialect);
        expect(formatted("##  Title {#id}  ##\n", config)).toBe("## Title {#id}  ##\n");
      }
    },
  );

  it("normalizes retained ATX headings with setext and consistent preferences", () => {
    for (const style of ["setext", "consistent"] as const) {
      const config = only({ "style/heading": ["warn", { style }] });
      expect(formatted("First\n=====\n\n###  Deep  ###\n\n> #  Quote\n", config)).toBe(
        "First\n=====\n\n### Deep\n\n> # Quote\n",
      );
    }
    expect(
      formatted(
        "#  First\n\n##  Second\n",
        only({ "style/heading": ["warn", { style: "consistent" }] }),
      ),
    ).toBe("# First\n\n## Second\n");
  });

  it("reports separators and applies the recommended preset", () => {
    expect(
      lint("#  Heading  #\n", { config: only({ "style/heading": ["warn", { closing: "keep" }] }) }),
    ).toHaveLength(2);
    expect(formatted("#  Heading  #\n", { extends: ["recommended"] })).toBe("# Heading\n");
  });
});
