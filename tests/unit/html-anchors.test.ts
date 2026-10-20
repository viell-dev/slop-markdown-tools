import { expect, it } from "vitest";
import { createWorkspace, lint } from "../../src/index.js";

// Attribute values independently checked with Chromium's DOMParser. The basic
// numeric/ampersand cases also match GitHub, Forgejo 16.0.6 and Gitea 28.2.0 (#451).
const cases = [
  ["a&#x2d;b", "a-b"],
  ["a&#45;b", "a-b"],
  ["a&amp;b", "a&b"],
  ["a&copy;z", "a©z"],
  ["a&amp;amp;b", "a&amp;b"],
  ["a&#x25;2d", "a%2d"],
  ["&#x75;ser-content-x", "user-content-x"],
  ["end&amp", "end&"],
  ["a&amp=b", "a&amp=b"],
  ["a&ampx", "a&ampx"],
  ["C&#128;", "C€"],
  ["bad&#0;", "bad�"],
  ["bad&#x110000;", "bad�"],
  ["bad&#xd800;", "bad�"],
  ["unicode&#x1f600;", "unicode😀"],
  ["a&#32;b", "a b"],
] as const;

it.each(cases)("decodes the HTML anchor %s exactly once (#451)", (written, decoded) => {
  for (const [tag, attribute] of [
    ["span", "id"],
    ["a", "name"],
  ]) {
    for (const quote of ['"', "'", ""]) {
      // An equals sign is not valid in an unquoted CommonMark HTML attribute.
      if (!quote && written.includes("=")) continue;
      const workspace = createWorkspace({
        "Doc.md": "",
        "Note.md": `<${tag} ${attribute}=${quote}${written}${quote}></${tag}>\n`,
      });
      const anchor = decoded.replace(/^user-content-/, "");
      for (const dialect of ["github", "commonmark", "forgejo", "gitea"] as const) {
        const url = `Note.md#${encodeURIComponent(anchor)}`;
        expect(
          workspace.resolve("Doc.md", url, dialect).fragmentExists,
          `${dialect}: ${quote}${written}`,
        ).toBe(true);
        expect(
          lint(`[go](${url})\n`, {
            config: { extends: [], dialect, rules: { "links/valid": "error" } },
            path: "Doc.md",
            workspace,
          }),
        ).toEqual([]);
        if (written !== decoded) {
          expect(
            workspace.resolve("Doc.md", `Note.md#${encodeURIComponent(written)}`, dialect)
              .fragmentExists,
          ).toBe(false);
        }
      }
      expect(
        workspace.resolve("Doc.md", `Note.md#${encodeURIComponent(anchor)}`, "obsidian")
          .fragmentExists,
      ).toBe(false);
    }
  }
});

it("keeps entity decoding separate from URL decoding and repeated decoding", () => {
  const workspace = createWorkspace({
    "Doc.md": "",
    "Note.md": '<a id="a&amp;amp;b"></a>\n\n<a id="a&#x25;2d"></a>\n',
  });
  for (const dialect of ["github", "forgejo", "gitea"] as const) {
    expect(workspace.resolve("Doc.md", "Note.md#a%26amp%3Bb", dialect).fragmentExists).toBe(true);
    expect(workspace.resolve("Doc.md", "Note.md#a%26b", dialect).fragmentExists).toBe(false);
    expect(workspace.resolve("Doc.md", "Note.md#a%252d", dialect).fragmentExists).toBe(true);
    expect(workspace.resolve("Doc.md", "Note.md#a-", dialect).fragmentExists).toBe(false);
  }
});
