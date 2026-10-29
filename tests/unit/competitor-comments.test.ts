import { expect, it } from "vitest";
import { format as prettier } from "prettier";
import { convertConfig, format, lint, parse, semanticFingerprint } from "../../src/index.js";
import type { ProcessOptions } from "../../src/index.js";

const ml = (values: Record<string, unknown> = {}): ProcessOptions => {
  const report = convertConfig({
    markdownlint: { default: false, MD049: { style: "underscore" }, ...values },
  });
  return {
    config: report.config,
    compatibility: JSON.parse(
      JSON.stringify(report.compatibility),
    ) as ProcessOptions["compatibility"],
  };
};
const pretty = (values: Record<string, unknown> = {}, both = false): ProcessOptions => {
  const report = convertConfig({
    prettier: values,
    ...(both ? { markdownlint: { default: false, MD049: { style: "underscore" } } } : {}),
  });
  return { config: report.config, compatibility: report.compatibility };
};
function checked(source: string, options: ProcessOptions) {
  const result = format(source, options);
  expect(result.diagnostics.filter((d) => d.rule.startsWith("engine/"))).toEqual([]);
  expect(format(result.output, options).output).toBe(result.output);
  expect(semanticFingerprint(parse(result.output, "github"))).toBe(
    semanticFingerprint(parse(source, "github")),
  );
  return result;
}
it.each(["MD049", "md049", "EMPHASIS-STYLE", "emphasis"])(
  "maps %s to its enabled origin",
  (name) => {
    const source = `<!-- markdownlint-disable ${name} -->\n\n*one*\n\n<!-- markdownlint-enable ${name} -->\n\n*two*\n`;
    expect(checked(source, ml()).output).toBe(source.replace("*two*", "_two_"));
  },
);
it.each(["\n", "\r\n"])("honors all line and file directives with %j", (eol) => {
  const options = ml();
  for (const name of ["", " MD049"]) {
    const next = `<!-- markdownlint-disable-next-line${name} -->\n*one*\n\n*two*\n`.replaceAll(
      "\n",
      eol,
    );
    expect(checked(next, options).output).toBe(next.replace("*two*", "_two_"));
    const line = `*one* <!-- markdownlint-disable-line${name} -->\n\n*two*\n`.replaceAll("\n", eol);
    expect(checked(line, options).output).toBe(line.replace("*two*", "_two_"));
    const file = `*one*\n\n<!-- markdownlint-disable-file${name} -->\n`.replaceAll("\n", eol);
    expect(checked(file, options).output).toBe(file);
    expect(
      checked(file + `<!-- markdownlint-enable-file${name} -->${eol}`, options).output,
    ).toContain("_one_");
  }
});
it("captures one snapshot, restores it repeatedly, and initially captures the file configuration", () => {
  const source =
    "<!-- markdownlint-disable -->\n\n*one*\n\n<!-- markdownlint-capture -->\n<!-- markdownlint-enable -->\n\n*two*\n\n<!-- markdownlint-restore -->\n\n*three*\n";
  expect(checked(source, ml()).output).toBe(source.replace("*two*", "_two_"));
  const initial = source.replace(
    "<!-- markdownlint-capture -->\n<!-- markdownlint-enable -->",
    "<!-- markdownlint-restore -->",
  );
  expect(checked(initial, ml()).output).toBe(
    initial.replace("*two*", "_two_").replace("*three*", "_three_"),
  );
});
it("applies transitions to their whole line, with the last transition winning", () => {
  const source = "*one* <!-- markdownlint-disable --> <!-- markdownlint-enable -->\n";
  expect(checked(source, ml()).output).toContain("_one_");
});
it("converts configure-file JSON throughout the file, applying comments in order", () => {
  const source = '*one*\n\n<!-- markdownlint-configure-file {"MD049":{"style":"asterisk"}} -->\n';
  expect(checked(source, ml()).output).toBe(source);
  const second =
    source + '<!-- markdownlint-configure-file {"emphasis-style":{"style":"underscore"}} -->\n';
  expect(checked(second, ml()).output).toContain("_one_");
  expect(lint(source + '<!-- markdownlint-configure-file {"MD049":false} -->\n', ml())).toEqual([]);
  const warnings: string[] = [];
  lint("<!-- markdownlint-configure-file nope -->\n*one*\n", {
    ...ml(),
    onCompatibilityWarning: (message) => warnings.push(message),
  });
  expect(warnings).toContain("Invalid markdownlint-configure-file JSON; comment ignored.");
});
it("reports unknown names without suppressing anything and ignores code examples", () => {
  const messages: string[] = [];
  const source =
    "<!-- markdownlint-disable NO-SUCH-RULE -->\n\n```html\n<!-- markdownlint-disable -->\n```\n\n*one*\n";
  expect(
    checked(source, { ...ml(), onCompatibilityWarning: (message) => messages.push(message) })
      .output,
  ).toContain("_one_");
  expect(messages[0]).toContain("no counterpart");
});
it.each([
  "<!-- prettier-ignore -->\n*one*\n",
  "<!-- prettier-ignore-start -->\n\n*one*\n\n<!-- prettier-ignore-end -->\n",
])("matches Prettier ignore output", async (source) => {
  expect(checked(source, pretty()).output).toBe(await prettier(source, { parser: "markdown" }));
});
it("preserves HTML following ignore even when it shares an HTML node", () => {
  const source = "<!-- prettier-ignore -->\n<div>  *one*  </div>\n";
  expect(checked(source, pretty()).output).toBe(source);
});
it("only accepts range ignores at the top level with blank lines", () => {
  const source =
    "> <!-- prettier-ignore-start -->\n>\n> *one*\n>\n> <!-- prettier-ignore-end -->\n";
  expect(checked(source, pretty()).output).toContain("_one_");
  const noBlank = "text\n<!-- prettier-ignore-start -->\n\n*one*\n\n<!-- prettier-ignore-end -->\n";
  expect(checked(noBlank, pretty()).output).toContain("_one_");
});
it.each(["@format", "@prettier"])("matches Prettier requirePragma for %s", async (pragma) => {
  const source = `<!-- ${pragma} -->\n\n*one*\n`;
  expect(checked(source, pretty({ requirePragma: true })).output).toBe(
    await prettier(source, { parser: "markdown", requirePragma: true }),
  );
  expect(checked("*one*\n", pretty({ requirePragma: true })).output).toBe("*one*\n");
  expect(checked(`text\n\n${source}`, pretty({ requirePragma: true })).output).toBe(
    `text\n\n${source}`,
  );
});
it("keeps markdownlint findings in Prettier ignores, and Prettier edits under markdownlint disables", () => {
  const ignored = "<!-- prettier-ignore -->\n\n*one*\n";
  const result = checked(ignored, pretty({}, true));
  expect(result.output).toBe(ignored);
  expect(result.diagnostics).toHaveLength(2);
  expect(result.diagnostics.every((d) => d.rule === "style/emphasis")).toBe(true);
  expect(result.diagnostics[0]?.edit).toBeUndefined();
  const disabled = "<!-- markdownlint-disable -->\n\n*one*\n";
  expect(checked(disabled, pretty({}, true)).output).toContain("_one_");
  expect(lint(disabled, pretty({}, true)).every((d) => d.severity === "warn")).toBe(true);
});
it("ignores every competitor comment with written configuration data", () => {
  const source =
    '<!-- markdownlint-disable-file -->\n<!-- markdownlint-disable -->\n<!-- markdownlint-disable-next-line -->\n*one* <!-- markdownlint-disable-line -->\n\n<!-- markdownlint-capture -->\n<!-- markdownlint-restore -->\n<!-- markdownlint-enable-file -->\n<!-- markdownlint-enable -->\n<!-- markdownlint-configure-file {"MD049":false} -->\n<!-- prettier-ignore-start -->\n\n<!-- prettier-ignore -->\n\n*two*\n\n<!-- prettier-ignore-end -->\n';
  const options = pretty({ requirePragma: true }, true);
  expect(checked(source, { config: options.config }).output).toContain("_one_");
  expect(checked(source, { config: options.config }).output).toContain("_two_");
});

it("keeps next-line associations while spacing is enabled and emits each notice once", () => {
  const options = ml({ MD022: true });
  const source = "<!-- markdownlint-disable-next-line MD049 -->\n# *one*\n";
  expect(checked(source, options).output).toBe(source);
  const warnings: string[] = [];
  format("<!-- markdownlint-disable unknown -->\n\n*one*\n", {
    ...options,
    onCompatibilityWarning: (message) => warnings.push(message),
  });
  expect(warnings.filter((m) => m.includes("unknown"))).toHaveLength(1);
});
it.each(["github", "obsidian", "vitepress", "forgejo", "gitea", "commonmark"] as const)(
  "preserves ignored ranges in %s",
  (dialect) => {
    const source =
      "<!-- prettier-ignore-start -->\n\n# *Heading*\n\n> *quote*\n\n- *item*\n\n| a | b |\n|---|---|\n| *x* | y |\n\n<!-- prettier-ignore-end -->\n";
    const options = pretty();
    expect(checked(source, { ...options, config: { ...options.config, dialect } }).output).toBe(
      source,
    );
  },
);

it("does not hold spacing for an unmapped next-line name", () => {
  const source = "<!-- markdownlint-disable-next-line unknown -->\n# *one*\n";
  const options = ml({ MD022: true });
  expect(checked(source, options).output).toBe(format(source, { config: options.config }).output);
});
