import { expect, it } from "vitest";
import { format, parse, semanticFingerprint, type Config } from "../../src/index.js";

for (const dialect of ["obsidian", "vitepress"] as const) {
  for (const eol of ["\n", "\r\n"]) {
    for (const [prefix, continuation] of [
      ["", ""],
      ["- ", "  "],
      ["- ", ""],
      ["> ", "> "],
      ["> ", ""],
    ]) {
      for (const [rule, marker] of [
        ["style/emphasis", "*"],
        ["style/strong", "__"],
      ] as const) {
        it(`keeps ${dialect} ${rule} across HTML ${JSON.stringify([prefix, continuation, eol])}`, () => {
          const tag = dialect === "obsidian" ? "<i>" : "<custom-tag/>";
          const source =
            dialect === "obsidian"
              ? `${prefix}a ${marker}b${eol}${continuation}${tag}${eol}${continuation}c${marker} d${eol}`
              : `${prefix}Alpha ${marker}words${eol}${continuation}${tag}${eol}${continuation}more${marker} words after${eol}`;
          const config: Config = { extends: [], dialect, rules: { [rule]: "warn" } };
          const result = format(source, { config });
          expect(result.diagnostics).toEqual([]);
          expect(result.output).toBe(source);
          expect(format(result.output, { config }).output).toBe(result.output);
          expect(semanticFingerprint(parse(result.output, dialect))).toBe(
            semanticFingerprint(parse(source, dialect)),
          );
        });
      }
    }
  }
}

for (const dialect of [
  "github",
  "forgejo",
  "gitea",
  "commonmark",
  "obsidian",
  "vitepress",
] as const) {
  it(`converts independent pairs beside HTML in ${dialect}`, () => {
    const config: Config = {
      extends: [],
      dialect,
      rules: {
        "style/emphasis": "warn",
        "style/strong": "warn",
        "content/emphasis-spacing": "warn",
      },
    };
    const source = "*before* and __bold__\n<br/>\n*after* and __bold__\n";
    const result = format(source, { config });
    expect(result.diagnostics).toEqual([]);
    expect(result.output).toBe("_before_ and **bold**\n<br/>\n_after_ and **bold**\n");
    expect(format(result.output, { config }).output).toBe(result.output);
    expect(semanticFingerprint(parse(result.output, dialect))).toBe(
      semanticFingerprint(parse(source, dialect)),
    );
  });
  it(`leaves multiline spacing and strikethrough alone in ${dialect}`, () => {
    const config: Config = {
      extends: [],
      dialect,
      rules: {
        "style/emphasis": "warn",
        "style/strong": "warn",
        "content/emphasis-spacing": "warn",
      },
    };
    for (const marker of ["*", "**", "~~"]) {
      const source = `Alpha ${marker} words\n<custom-tag/>\nmore ${marker} words after\n`;
      const result = format(source, { config });
      expect(result.diagnostics).toEqual([]);
      expect(result.output).toBe(source);
    }
  });
}
