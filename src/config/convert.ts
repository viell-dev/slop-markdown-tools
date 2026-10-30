import { prepare } from "../core/rule-registry.js";
import type { Config, RuleSetting } from "../core/types.js";

type Values = Record<string, unknown>;
type OptionMap = Record<string, string>;
/** One competitor behavior, its options, and its destination or coverage issue. */
export interface CompetitorMapping {
  /** Competitor rule ID, option name, or fixed behavior. */
  source: string;
  /** Long markdownlint rule name accepted in configuration. */
  alias?: string;
  /** Additional historical markdownlint rule names. */
  aliases?: readonly string[];
  /** markdownlint tags, from its 0.42 rule documentation. */
  tags?: readonly string[];
  /** Destination mdrefine rule, when available. */
  rule?: string;
  /** Competitor defaults expressed as mdrefine options. */
  defaults?: Values;
  /** Competitor option names mapped to mdrefine option names. */
  options?: OptionMap;
  /** Coverage issue for missing or partial behavior. */
  issue?: number;
  /** Whether markdownlint disables this rule by default. */
  disabled?: boolean;
}
/** One row per competitor check; option names and defaults live with their destination. */
export const competitorMappings: readonly CompetitorMapping[] = [
  {
    source: "MD001",
    tags: ["headings"],
    alias: "heading-increment",
    rule: "structure/heading-increment",
    defaults: { frontMatterTitle: true },
    options: { front_matter_title: "frontMatterTitle" },
  },
  {
    source: "MD003",
    tags: ["headings"],
    alias: "heading-style",
    rule: "style/heading",
    defaults: { style: "consistent", closing: "keep" },
    options: { style: "style" },
  },
  {
    source: "MD004",
    tags: ["bullet", "ul"],
    alias: "ul-style",
    rule: "style/list-marker",
    defaults: { marker: "consistent" },
    options: { style: "marker" },
  },
  {
    source: "MD005",
    tags: ["bullet", "indentation", "ul"],
    alias: "list-indent",
    rule: "style/list-indent",
  },
  {
    source: "MD007",
    tags: ["bullet", "indentation", "ul"],
    alias: "ul-indent",
    rule: "style/list-indent",
    defaults: { nestedIndent: 2, startIndented: false, startIndent: 2 },
    options: {
      indent: "nestedIndent",
      start_indented: "startIndented",
      start_indent: "startIndent",
    },
  },
  {
    source: "MD009",
    tags: ["whitespace"],
    alias: "no-trailing-spaces",
    rule: "style/trailing-space",
    defaults: { hardBreakSpaces: 2, listItemEmptyLines: false },
    options: {
      br_spaces: "hardBreakSpaces",
      list_item_empty_lines: "listItemEmptyLines",
      code_blocks: "codeBlocks",
    },
  },
  {
    source: "MD010",
    tags: ["hard_tab", "whitespace"],
    alias: "no-hard-tabs",
    rule: "style/no-tabs",
    defaults: { codeBlocks: true, spacesPerTab: 1 },
    options: {
      code_blocks: "codeBlocks",
      ignore_code_languages: "ignoredCodeLanguages",
      spaces_per_tab: "spacesPerTab",
    },
  },
  { source: "MD011", tags: ["links"], alias: "no-reversed-links", rule: "links/reversed" },
  {
    source: "MD012",
    tags: ["blank_lines", "whitespace"],
    alias: "no-multiple-blanks",
    rule: "style/blank-lines",
    defaults: { maximum: 1 },
    options: { maximum: "maximum" },
  },
  {
    source: "MD013",
    tags: ["line_length"],
    alias: "line-length",
    rule: "content/line-length",
    defaults: { measure: "codepoints" },
    options: {
      line_length: "lineLength",
      heading_line_length: "headingLineLength",
      code_block_line_length: "codeBlockLineLength",
      code_blocks: "codeBlocks",
      headings: "headings",
      tables: "tables",
      strict: "strict",
      stern: "stern",
    },
  },
  { source: "MD014", tags: ["code"], alias: "commands-show-output", rule: "content/shell-prompt" },
  {
    source: "MD018",
    tags: ["atx", "headings", "spaces"],
    alias: "no-missing-space-atx",
    rule: "structure/unspaced-heading",
  },
  {
    source: "MD019",
    tags: ["atx", "headings", "spaces"],
    alias: "no-multiple-space-atx",
    rule: "style/heading",
  },
  {
    source: "MD020",
    tags: ["atx_closed", "headings", "spaces"],
    alias: "no-missing-space-closed-atx",
    rule: "structure/unspaced-heading",
  },
  {
    source: "MD021",
    tags: ["atx_closed", "headings", "spaces"],
    alias: "no-multiple-space-closed-atx",
    rule: "style/heading",
  },
  {
    source: "MD022",
    tags: ["blank_lines", "headings"],
    alias: "blanks-around-headings",
    rule: "style/block-spacing",
    defaults: { linesAbove: 1, linesBelow: 1, includeFrontMatter: false },
    options: {
      lines_above: "linesAbove",
      lines_below: "linesBelow",
      include_front_matter: "includeFrontMatter",
    },
  },
  {
    source: "MD023",
    tags: ["headings", "spaces"],
    alias: "heading-start-left",
    rule: "style/heading",
  },
  {
    source: "MD024",
    tags: ["headings"],
    alias: "no-duplicate-heading",
    rule: "structure/duplicate-heading",
    defaults: { siblingsOnly: false },
    options: { siblings_only: "siblingsOnly", allow_different_nesting: "siblingsOnly" },
  },
  {
    source: "MD025",
    tags: ["headings"],
    alias: "single-title",
    aliases: ["single-h1"],
    rule: "structure/single-title",
    defaults: { frontMatterTitle: true },
    options: { level: "level", front_matter_title: "frontMatterTitle" },
  },
  {
    source: "MD026",
    tags: ["headings"],
    alias: "no-trailing-punctuation",
    rule: "structure/heading-punctuation",
    options: { punctuation: "punctuation" },
  },
  {
    source: "MD027",
    tags: ["blockquote", "indentation", "whitespace"],
    alias: "no-multiple-space-blockquote",
    rule: "style/quote-marker",
    options: { list_items: "listItems" },
  },
  {
    source: "MD028",
    tags: ["blockquote", "whitespace"],
    alias: "no-blanks-blockquote",
    rule: "structure/split-quote",
  },
  {
    source: "MD029",
    tags: ["ol"],
    alias: "ol-prefix",
    rule: "style/ordered-list",
    defaults: { numbering: "auto", delimiter: "consistent" },
    options: { style: "numbering" },
  },
  {
    source: "MD030",
    tags: ["ol", "ul", "whitespace"],
    alias: "list-marker-space",
    rule: "style/list-indent",
    options: {
      ul_single: "bulletSpaces",
      ol_single: "orderedSpaces",
      ul_multi: "bulletSpacesMultiline",
      ol_multi: "orderedSpacesMultiline",
    },
  },
  {
    source: "MD031",
    tags: ["blank_lines", "code"],
    alias: "blanks-around-fences",
    rule: "style/block-spacing",
    options: {},
  },
  {
    source: "MD032",
    tags: ["blank_lines", "bullet", "ol", "ul"],
    alias: "blanks-around-lists",
    rule: "style/block-spacing",
  },
  {
    source: "MD033",
    tags: ["html"],
    alias: "no-inline-html",
    rule: "content/html-element",
    options: {
      allowed_elements: "allowedElements",
      table_allowed_elements: "tableAllowedElements",
    },
  },
  { source: "MD034", tags: ["links", "url"], alias: "no-bare-urls", rule: "links/bare-url" },
  {
    source: "MD035",
    tags: ["hr"],
    alias: "hr-style",
    rule: "style/thematic-break",
    defaults: { marker: "consistent" },
    options: { style: "marker" },
  },
  {
    source: "MD036",
    tags: ["emphasis", "headings"],
    alias: "no-emphasis-as-heading",
    rule: "structure/emphasis-heading",
    options: { punctuation: "punctuation" },
  },
  {
    source: "MD037",
    tags: ["emphasis", "whitespace"],
    alias: "no-space-in-emphasis",
    rule: "content/emphasis-spacing",
  },
  {
    source: "MD038",
    tags: ["code", "whitespace"],
    alias: "no-space-in-code",
    rule: "content/inline-code-spacing",
  },
  {
    source: "MD039",
    tags: ["links", "whitespace"],
    alias: "no-space-in-links",
    rule: "links/text-spacing",
  },
  {
    source: "MD040",
    tags: ["code", "language"],
    alias: "fenced-code-language",
    rule: "content/code-language",
    options: { allowed_languages: "allowedLanguages", language_only: "languageOnly" },
  },
  {
    source: "MD041",
    tags: ["headings"],
    alias: "first-line-heading",
    rule: "structure/initial-heading",
    defaults: { frontMatterTitle: true },
    options: {
      level: "level",
      allow_preamble: "allowPreamble",
      front_matter_title: "frontMatterTitle",
    },
  },
  { source: "MD042", tags: ["links"], alias: "no-empty-links", rule: "links/empty" },
  {
    source: "MD043",
    tags: ["headings"],
    alias: "required-headings",
    rule: "structure/heading-template",
    options: { headings: "headings", match_case: "matchCase" },
    disabled: true,
  },
  {
    source: "MD044",
    tags: ["spelling"],
    alias: "proper-names",
    rule: "content/proper-names",
    defaults: { codeBlocks: true },
    options: { names: "names", code_blocks: "codeBlocks", html_elements: "htmlElements" },
    disabled: true,
  },
  {
    source: "MD045",
    tags: ["accessibility", "images"],
    alias: "no-alt-text",
    rule: "content/image-alt",
  },
  {
    source: "MD046",
    tags: ["code"],
    alias: "code-block-style",
    rule: "style/code-block",
    options: { style: "style" },
  },
  {
    source: "MD047",
    tags: ["blank_lines"],
    alias: "single-trailing-newline",
    rule: "style/final-newline",
  },
  {
    source: "MD048",
    tags: ["code"],
    alias: "code-fence-style",
    rule: "style/code-fence",
    defaults: { marker: "consistent" },
    options: { style: "marker" },
  },
  {
    source: "MD049",
    tags: ["emphasis"],
    alias: "emphasis-style",
    rule: "style/emphasis",
    defaults: { marker: "consistent" },
    options: { style: "marker" },
  },
  {
    source: "MD050",
    tags: ["emphasis"],
    alias: "strong-style",
    rule: "style/strong",
    defaults: { marker: "consistent" },
    options: { style: "marker" },
  },
  {
    source: "MD051",
    tags: ["links"],
    alias: "link-fragments",
    rule: "links/valid",
    options: { ignored_pattern: "ignoredFragments", ignore_case: "exactCase" },
  },
  {
    source: "MD052",
    tags: ["images", "links"],
    defaults: { ignoredLabels: ["x"] },
    alias: "reference-links-images",
    rule: "links/undefined-reference",
    options: { shortcut_syntax: "shortcutSyntax", ignored_labels: "ignoredLabels" },
  },
  {
    source: "MD053",
    tags: ["images", "links"],
    alias: "link-image-reference-definitions",
    rule: "links/unused-definition",
    options: { ignored_definitions: "ignoredDefinitions" },
  },
  {
    source: "MD054",
    tags: ["images", "links"],
    alias: "link-image-style",
    rule: "links/allowed-notation",
    options: {
      autolink: "autolink",
      inline: "inline",
      full: "full",
      collapsed: "collapsed",
      shortcut: "shortcut",
      url_inline: "urlInline",
    },
    disabled: true,
  },
  {
    source: "MD055",
    tags: ["table"],
    alias: "table-pipe-style",
    rule: "style/table",
    defaults: { pipeStyle: "consistent" },
    options: { style: "pipeStyle" },
  },
  { source: "MD056", tags: ["table"], alias: "table-column-count", rule: "content/table-columns" },
  { source: "MD058", tags: ["table"], alias: "blanks-around-tables", rule: "style/block-spacing" },
  {
    source: "MD059",
    tags: ["accessibility", "links"],
    alias: "descriptive-link-text",
    rule: "links/descriptive-text",
    options: { prohibited_texts: "prohibitedTexts" },
  },
  {
    source: "MD060",
    tags: ["table"],
    alias: "table-column-style",
    rule: "style/table",
    options: { style: "style", aligned_delimiter: "alignedDelimiter" },
    disabled: true,
  },
  { source: "proseWrap", rule: "style/wrap", options: { proseWrap: "mode", printWidth: "width" } },
  { source: "tabWidth", rule: "style/list-indent", options: { tabWidth: "nestedIndent" } },
  { source: "printWidth", rule: "style/wrap", options: { printWidth: "width" } },
  { source: "useTabs" },
  { source: "semi" },
  { source: "quoteProps" },
  { source: "jsxSingleQuote" },
  { source: "trailingComma" },
  { source: "bracketSpacing" },
  { source: "bracketSameLine" },
  { source: "arrowParens" },
  { source: "htmlWhitespaceSensitivity" },
  { source: "vueIndentScriptAndStyle" },
  { source: "experimentalTernaries" },
  { source: "experimentalOperatorPosition" },
  { source: "objectWrap" },
  { source: "parser" },
  { source: "filepath" },
  { source: "rangeStart" },
  { source: "rangeEnd" },
  { source: "plugins" },
  { source: "checkIgnorePragma" },
  {
    source: "endOfLine",
    rule: "style/line-ending",
    defaults: { endOfLine: "lf" },
    options: { endOfLine: "endOfLine" },
  },
  { source: "embeddedLanguageFormatting" },
  { source: "singleQuote", rule: "style/link-title" },
  { source: "requirePragma" },
  { source: "insertPragma" },
  { source: "emphasis", rule: "style/emphasis", defaults: { marker: "_" } },
  { source: "strong", rule: "style/strong", defaults: { marker: "*" } },
  { source: "headings", rule: "style/heading", defaults: { style: "atx", closing: "remove" } },
  { source: "bullets", rule: "style/list-marker", defaults: { marker: "-" } },
  {
    source: "numbering",
    rule: "style/ordered-list",
    defaults: { numbering: "auto", delimiter: "." },
  },
  {
    source: "list spacing",
    rule: "style/list-indent",
    defaults: { bulletSpaces: 1, orderedSpaces: 1 },
  },
  { source: "fences", rule: "style/code-fence", defaults: { marker: "```" } },
  { source: "thematic breaks", rule: "style/thematic-break", defaults: { marker: "---" } },
  {
    source: "tables",
    rule: "style/table",
    defaults: { style: "aligned", padding: "alignment", pipeStyle: "leadingAndTrailing" },
  },
  { source: "trailing spaces", rule: "style/trailing-space", defaults: { hardBreakSpaces: 2 } },
  { source: "blank lines", rule: "style/blank-lines" },
  { source: "block spacing", rule: "style/block-spacing" },
  { source: "final newline", rule: "style/final-newline" },
  { source: "code spans", rule: "style/inline-code" },
  { source: "quote spacing", rule: "style/quote-marker" },
  { source: "lazy continuations", rule: "style/lazy-continuation" },
  { source: "definitions", rule: "style/definition-spacing" },
  { source: "front matter" },
  { source: "prose spacing", rule: "style/prose-space" },
];

/** Portable runtime provenance supplied by competitor configuration fallback. */
export interface CompetitorCompatibility {
  /** Original data, retained portably for configure-file comments. */
  markdownlint?: Values;
  /** Original Prettier data, including requirePragma. */
  prettier?: Values;
  /** Enabled competitor checks grouped by destination rule. */
  origins: Record<string, string[]>;
  /** Prettier pragma overrides, in configuration order. */
  pragmaOverrides?: { files: string[]; requirePragma: boolean }[];
}
/** Converted configuration with the information needed to review its limits. */
export interface ConversionReport {
  /** Runtime provenance; never written into an mdrefine configuration. */
  compatibility: CompetitorCompatibility;
  /** Configuration with no implicit preset, or `{}` when no source could be used. */
  config: Config;
  /** Configuration files read by the Node loader; empty for object conversion. */
  sources: string[];
  /**
   * Configuration files the Node loader found and did not use, each with the
   * reason: a format it does not read, a Prettier configuration whose
   * `.prettierignore` excludes all Markdown, or, for the fallback, a
   * `.prettierignore` with negated entries. With no source to use, `config`
   * is empty, so the defaults apply, and `sources` is empty.
   */
  unused: { file: string; reason: string }[];
  /** Settings not fully carried over, with reasons and applicable tracking issues. */
  omitted: string[];
  /** Conflicting settings and the choice made. */
  conflicts: string[];
  /** Additional mdrefine capabilities to consider. */
  suggestions: string[];
}
/** Convert data only. Filesystem discovery and explicit script loading belong to mdrefine/node. */
export function convertConfig(input: {
  markdownlint?: Values;
  prettier?: Values;
}): ConversionReport {
  const rules: Record<string, RuleSetting> = {};
  const report: ConversionReport = {
    compatibility: { ...input, origins: {} },
    config: { extends: [], rules },
    sources: [],
    unused: [],
    omitted: [],
    conflicts: [],
    suggestions: [],
  };
  const owners = new Map<string, string>();
  const set = (row: CompetitorMapping, options: Values, explicit = false) => {
    if (!row.rule) return;
    (report.compatibility.origins[row.rule] ??= []).push(row.source);
    const previous = rules[row.rule];
    const before: Values = Array.isArray(previous) ? (previous[1] as Values) : {};
    for (const [key, value] of Object.entries(options)) {
      if (key in before && JSON.stringify(before[key]) !== JSON.stringify(value))
        report.conflicts.push(
          `${row.rule}.${key}: ${row.source} wins over ${owners.get(row.rule) ?? "another setting"}${explicit ? " (explicit markdownlint choice)" : ""}.`,
        );
    }
    const merged = { ...before, ...options };
    for (const key of Object.keys(merged)) {
      try {
        prepare({
          config: { extends: [], rules: { [row.rule]: ["warn", { [key]: merged[key] }] } },
        });
      } catch {
        report.omitted.push(
          `${row.source}.${key}: value ${JSON.stringify(merged[key])} is outside the mdrefine option range; ${row.issue ? `#${row.issue}.` : "No equivalent option value."}`,
        );
        delete merged[key];
      }
    }
    rules[row.rule] = [
      row.source.startsWith("MD") || (Array.isArray(previous) && previous[0] === "error")
        ? "error"
        : "warn",
      merged,
    ];
    owners.set(row.rule, row.source);
  };
  if (input.prettier) {
    const p = input.prettier;
    report.omitted.push(
      "Prettier headings: Setext headings become ATX; mixed heading-style preservation has no counterpart.",
    );
    for (const row of competitorMappings.filter((r) => !r.source.startsWith("MD"))) {
      if (row.defaults || (row.rule && !row.options && !["singleQuote"].includes(row.source)))
        set(row, row.defaults ?? {});
      if (row.source === "requirePragma" && p.requirePragma === true)
        report.omitted.push(
          "Prettier requirePragma: applies during fallback only; has no effect with a written mdrefine configuration.",
        );
      else if (row.source === "insertPragma" && p.insertPragma === true)
        report.omitted.push(
          "Prettier insertPragma: not carried over; mdrefine does not write competitor comments.",
        );
      else if (row.issue && !row.source.endsWith("Pragma") && (row.source in p || row.defaults))
        report.omitted.push(`Prettier ${row.source}: incomplete; #${row.issue}.`);
    }
    const rowFor = (source: string) => competitorMappings.find((row) => row.source === source)!;
    set(rowFor("singleQuote"), { delimiter: p.singleQuote === true ? "single" : "double" });
    if (typeof p.endOfLine === "string") set(rowFor("endOfLine"), { endOfLine: p.endOfLine });
    report.omitted.push(
      "Prettier front matter: configure a front matter formatter (codeFormatters with frontMatter) to format it; mdrefine bundles no YAML printer.",
    );
    set(rowFor("tabWidth"), { bulletSpaces: 1, orderedSpaces: 1, nestedIndent: p.tabWidth ?? 2 });
    if (p.proseWrap === "always") set(rowFor("proseWrap"), { width: p.printWidth ?? 80 });
    if ("embeddedLanguageFormatting" in p)
      report.omitted.push(
        "Prettier embeddedLanguageFormatting: configure code formatters explicitly; plugins are not executed by conversion.",
      );
    const known = new Set([
      "printWidth",
      "overrides",
      ...competitorMappings.filter((r) => !r.source.startsWith("MD")).map((r) => r.source),
    ]);
    for (const key of Object.keys(p))
      if (!known.has(key))
        report.omitted.push(`Prettier ${key}: no Markdown mapping; requires manual migration.`);
    if (p.proseWrap === "never") set(rowFor("proseWrap"), { mode: "never" });
    for (const key of [
      "parser",
      "filepath",
      "rangeStart",
      "rangeEnd",
      "plugins",
      "checkIgnorePragma",
    ])
      if (key in p)
        report.omitted.push(
          `Prettier ${key}: file-context or plugin behavior requires manual migration.`,
        );
  }
  if (input.markdownlint) {
    const m = Object.create(null) as Values;
    for (const [rawKey, rawValue] of Object.entries(input.markdownlint)) {
      const key = rawKey.toLowerCase();
      const rows = competitorMappings.filter(
        (row) =>
          row.source.startsWith("MD") &&
          (row.source.toLowerCase() === key ||
            row.alias === key ||
            row.aliases?.includes(key) ||
            row.tags?.includes(key)),
      );
      const value =
        rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
          ? (rawValue as Values).enabled === false
            ? false
            : Object.fromEntries(Object.entries(rawValue).filter(([name]) => name !== "enabled"))
          : rawValue;
      if (rows.length) for (const row of rows) m[row.source] = value;
      else m[key] = value;
    }
    for (const row of competitorMappings.filter((r) => r.source.startsWith("MD"))) {
      const setting = m[row.source];
      if (setting === false || (setting === undefined && (m.default === false || row.disabled)))
        continue;
      const options = { ...row.defaults };
      if (setting && typeof setting === "object") {
        for (const [key, value] of Object.entries(setting)) {
          const target = row.options?.[key];
          if (target) options[target] = key === "ignore_case" ? !value : value;
          else if (!["MD009.strict", "MD031.list_items"].includes(`${row.source}.${key}`))
            report.omitted.push(
              `${row.source}.${key}: not carried over; ${row.issue ? `#${row.issue}.` : "No equivalent option value."}`,
            );
        }
      }
      if (row.source === "MD003") {
        const style = String(options.style);
        if (["atx_closed", "setext_with_atx_closed"].includes(style)) options.closing = "add";
        if (style.includes("closed")) options.style = "atx";
        if (style.startsWith("setext_with")) options.style = "setext";
      }
      if (["MD004", "MD048", "MD049", "MD050"].includes(row.source))
        options.marker =
          (
            {
              asterisk: "*",
              underscore: "_",
              dash: "-",
              plus: "+",
              backtick: "```",
              tilde: "~~~",
            } as Values
          )[String(options.marker)] ?? options.marker;
      if (row.source === "MD055" && typeof options.pipeStyle === "string")
        options.pipeStyle = options.pipeStyle.replace(
          /_([a-z])/g,
          (_match: string, letter: string) => letter.toUpperCase(),
        );
      if (row.source === "MD029" && options.numbering === "one_or_ordered")
        options.numbering = "auto";
      if (row.source === "MD060" && options.style === undefined) options.style = "any";
      if (row.source === "MD029" && ["one", "zero"].includes(String(options.numbering)))
        report.omitted.push(
          `MD029 style:${String(options.numbering)}: the required start number is not carried over; existing list starts are preserved for rendering.`,
        );
      if (row.source === "MD029")
        options.numbering = ["one", "zero"].includes(String(options.numbering))
          ? "same"
          : options.numbering;
      if (row.source === "MD060" && options.style === "any") {
        delete options.style;
        report.omitted.push("MD060 style:any: a formatter needs a target style.");
      }
      // Only stated option values override Prettier; enabled checks still retain error severity.
      if (input.prettier && row.rule && rules[row.rule]) {
        for (const key of Object.keys(options)) {
          const stated =
            setting &&
            typeof setting === "object" &&
            Object.keys(setting).some(
              (source) =>
                row.options?.[source] === key ||
                (row.source === "MD003" && key === "closing" && source === "style"),
            );
          if (!stated) delete options[key];
        }
      }
      if (row.source === "MD009")
        report.omitted.push(
          "MD009.strict: cleanup is always strict outside preserved hard breaks; no separate switch.",
        );
      if (
        row.source === "MD031" &&
        (!(setting && typeof setting === "object") || (setting as Values).list_items !== false)
      )
        report.omitted.push(
          "MD031.list_items: true: spacing inside list items is left as written for safety.",
        );
      if (row.source === "MD013" && !rules["style/wrap"]) {
        report.omitted.push(
          "MD013: paragraph lines are not checked; content/line-length checks headings, code and tables only.",
        );
        // A width that is not a usable number, such as "wide", `true` or `null`,
        // is reported as outside the range above; the suggestion then names no
        // width. Without a setting, markdownlint's default of 80 applies.
        const width = options.lineLength === undefined ? 80 : options.lineLength;
        report.suggestions.push(
          typeof width === "number" && Number.isInteger(width) && width > 0
            ? `Consider style/wrap with width ${width} to reflow paragraph lines.`
            : "Consider style/wrap to reflow paragraph lines.",
        );
      }
      if (row.source === "MD007" && input.prettier) {
        if (
          options.nestedIndent !== undefined &&
          options.nestedIndent !== (input.prettier.tabWidth ?? 2)
        )
          report.conflicts.push(
            "style/list-indent.nestedIndent: Prettier tabWidth wins over MD007.",
          );
        options.nestedIndent = input.prettier.tabWidth ?? 2;
      }
      set(row, options, setting !== undefined);
      if (row.issue)
        report.omitted.push(`${row.source}: partial or missing counterpart; #${row.issue}.`);
    }
    for (const row of competitorMappings.filter((r) => r.source.startsWith("MD"))) {
      if (m[row.source] !== false || !row.rule || !rules[row.rule]) continue;
      const another = competitorMappings.some(
        (r) =>
          r !== row &&
          r.source.startsWith("MD") &&
          r.rule === row.rule &&
          m[r.source] !== false &&
          (m[r.source] !== undefined || (m.default !== false && !r.disabled)),
      );
      if (another)
        report.omitted.push(
          `${row.source}: disabled, but ${row.rule} also implements another enabled check.`,
        );
      else if (input.prettier && rules[row.rule]) {
        report.conflicts.push(
          `${row.source}: disabled markdownlint check leaves Prettier's ${row.rule} choice enabled.`,
        );
      } else rules[row.rule] = "off";
    }
    for (const key of Object.keys(m))
      if (key !== "default" && !competitorMappings.some((r) => r.source === key))
        report.omitted.push(
          `markdownlint ${key}: unknown rule or option; requires manual migration.`,
        );
  }
  const links = rules["links/valid"];
  report.suggestions.push(
    links && links !== "off"
      ? "links/valid, the counterpart of MD051, also reports local links whose files do not exist."
      : "Consider links/valid, which checks that local links and their fragments exist.",
  );
  const spacing = rules["style/block-spacing"];
  const blanks = rules["style/blank-lines"];
  if (Array.isArray(spacing) && Array.isArray(blanks)) {
    const spacingOptions = spacing[1] as Values;
    const blankOptions = blanks[1] as Values;
    const count = Math.max(
      1,
      ...[spacingOptions.linesAbove, spacingOptions.linesBelow].flatMap((v) =>
        Array.isArray(v) ? (v as number[]) : typeof v === "number" ? [v] : [],
      ),
    );
    if (count > Number(blankOptions.maximum ?? 1)) {
      rules["style/blank-lines"] = [blanks[0], { ...blankOptions, maximum: count }];
      report.conflicts.push(`MD022 heading spacing wins over MD012: maximum raised to ${count}.`);
    }
  }
  return report;
}
