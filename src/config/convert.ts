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
    alias: "heading-increment",
    rule: "structure/heading-increment",
    defaults: { frontMatterTitle: true },
    options: { front_matter_title: "frontMatterTitle" },
  },
  {
    source: "MD003",
    alias: "heading-style",
    rule: "style/heading",
    defaults: { style: "consistent", closing: "keep" },
    options: { style: "style" },
  },
  {
    source: "MD004",
    alias: "ul-style",
    rule: "style/list-marker",
    defaults: { marker: "consistent" },
    options: { style: "marker" },
  },
  { source: "MD005", alias: "list-indent", rule: "style/list-indent" },
  {
    source: "MD007",
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
    alias: "no-trailing-spaces",
    rule: "style/trailing-space",
    defaults: { hardBreakSpaces: 2, listItemEmptyLines: false },
    options: { br_spaces: "hardBreakSpaces", list_item_empty_lines: "listItemEmptyLines" },
    issue: 702,
  },
  {
    source: "MD010",
    alias: "no-hard-tabs",
    rule: "style/no-tabs",
    defaults: { codeBlocks: true, spacesPerTab: 1 },
    options: {
      code_blocks: "codeBlocks",
      ignore_code_languages: "ignoredCodeLanguages",
      spaces_per_tab: "spacesPerTab",
    },
  },
  { source: "MD011", alias: "no-reversed-links", rule: "links/reversed" },
  {
    source: "MD012",
    alias: "no-multiple-blanks",
    rule: "style/blank-lines",
    defaults: { maximum: 1 },
    options: { maximum: "maximum" },
  },
  {
    source: "MD013",
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
  { source: "MD014", alias: "commands-show-output", rule: "content/shell-prompt" },
  { source: "MD018", alias: "no-missing-space-atx", rule: "structure/unspaced-heading" },
  { source: "MD019", alias: "no-multiple-space-atx", rule: "style/heading" },
  { source: "MD020", alias: "no-missing-space-closed-atx", rule: "structure/unspaced-heading" },
  { source: "MD021", alias: "no-multiple-space-closed-atx", rule: "style/heading" },
  {
    source: "MD022",
    alias: "blanks-around-headings",
    rule: "style/block-spacing",
    defaults: { linesAbove: 1, linesBelow: 1, includeFrontMatter: true },
    options: {
      lines_above: "linesAbove",
      lines_below: "linesBelow",
      include_front_matter: "includeFrontMatter",
    },
  },
  { source: "MD023", alias: "heading-start-left", rule: "style/heading" },
  {
    source: "MD024",
    alias: "no-duplicate-heading",
    rule: "structure/duplicate-heading",
    defaults: { siblingsOnly: false },
    options: { siblings_only: "siblingsOnly", allow_different_nesting: "siblingsOnly" },
  },
  {
    source: "MD025",
    alias: "single-title",
    rule: "structure/single-title",
    defaults: { frontMatterTitle: true },
    options: { level: "level", front_matter_title: "frontMatterTitle" },
  },
  {
    source: "MD026",
    alias: "no-trailing-punctuation",
    rule: "structure/heading-punctuation",
    options: { punctuation: "punctuation" },
  },
  { source: "MD027", alias: "no-multiple-space-blockquote", issue: 682 },
  { source: "MD028", alias: "no-blanks-blockquote", rule: "structure/split-quote" },
  {
    source: "MD029",
    alias: "ol-prefix",
    rule: "style/ordered-list",
    defaults: { numbering: "auto", delimiter: "consistent" },
    options: { style: "numbering" },
  },
  {
    source: "MD030",
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
    alias: "blanks-around-fences",
    rule: "style/block-spacing",
    options: {},
    issue: 684,
  },
  { source: "MD032", alias: "blanks-around-lists", rule: "style/block-spacing" },
  { source: "MD033", alias: "no-inline-html", issue: 685 },
  { source: "MD034", alias: "no-bare-urls", rule: "links/bare-url" },
  {
    source: "MD035",
    alias: "hr-style",
    rule: "style/thematic-break",
    defaults: { marker: "consistent" },
    options: { style: "marker" },
  },
  {
    source: "MD036",
    alias: "no-emphasis-as-heading",
    rule: "structure/emphasis-heading",
    options: { punctuation: "punctuation" },
  },
  { source: "MD037", alias: "no-space-in-emphasis", rule: "content/emphasis-spacing" },
  { source: "MD038", alias: "no-space-in-code", rule: "content/inline-code-spacing" },
  { source: "MD039", alias: "no-space-in-links", rule: "links/text-spacing" },
  {
    source: "MD040",
    alias: "fenced-code-language",
    rule: "content/code-language",
    options: { allowed_languages: "allowedLanguages", language_only: "languageOnly" },
  },
  {
    source: "MD041",
    alias: "first-line-heading",
    rule: "structure/initial-heading",
    defaults: { frontMatterTitle: true },
    options: {
      level: "level",
      allow_preamble: "allowPreamble",
      front_matter_title: "frontMatterTitle",
    },
  },
  { source: "MD042", alias: "no-empty-links", rule: "links/empty" },
  {
    source: "MD043",
    alias: "required-headings",
    rule: "structure/heading-template",
    options: { headings: "headings", match_case: "matchCase" },
    disabled: true,
  },
  {
    source: "MD044",
    alias: "proper-names",
    rule: "content/proper-names",
    defaults: { codeBlocks: true },
    options: { names: "names", code_blocks: "codeBlocks", html_elements: "htmlElements" },
    disabled: true,
  },
  { source: "MD045", alias: "no-alt-text", rule: "content/image-alt", issue: 694 },
  {
    source: "MD046",
    alias: "code-block-style",
    rule: "style/code-block",
    options: { style: "style" },
  },
  { source: "MD047", alias: "single-trailing-newline", rule: "style/final-newline" },
  {
    source: "MD048",
    alias: "code-fence-style",
    rule: "style/code-fence",
    defaults: { marker: "consistent" },
    options: { style: "marker" },
  },
  {
    source: "MD049",
    alias: "emphasis-style",
    rule: "style/emphasis",
    defaults: { marker: "consistent" },
    options: { style: "marker" },
  },
  {
    source: "MD050",
    alias: "strong-style",
    rule: "style/strong",
    defaults: { marker: "consistent" },
    options: { style: "marker" },
  },
  {
    source: "MD051",
    alias: "link-fragments",
    rule: "links/valid",
    options: { ignored_pattern: "ignoredFragments", ignore_case: "exactCase" },
  },
  {
    source: "MD052",
    alias: "reference-links-images",
    rule: "links/undefined-reference",
    options: { shortcut_syntax: "shortcutSyntax", ignored_labels: "ignoredLabels" },
  },
  {
    source: "MD053",
    alias: "link-image-reference-definitions",
    rule: "links/unused-definition",
    options: { ignored_definitions: "ignoredDefinitions" },
  },
  {
    source: "MD054",
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
    alias: "table-pipe-style",
    rule: "style/table",
    defaults: { pipeStyle: "consistent" },
    options: { style: "pipeStyle" },
  },
  { source: "MD056", alias: "table-column-count", rule: "content/table-columns" },
  { source: "MD058", alias: "blanks-around-tables", rule: "style/block-spacing", issue: 697 },
  {
    source: "MD059",
    alias: "descriptive-link-text",
    rule: "links/descriptive-text",
    options: { prohibited_texts: "prohibitedTexts" },
  },
  {
    source: "MD060",
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
  { source: "parser", issue: 669 },
  { source: "filepath", issue: 669 },
  { source: "rangeStart", issue: 669 },
  { source: "rangeEnd", issue: 669 },
  { source: "plugins", issue: 669 },
  { source: "checkIgnorePragma", issue: 669 },
  { source: "endOfLine", issue: 712, defaults: {} },
  { source: "embeddedLanguageFormatting", issue: 718, defaults: {} },
  { source: "singleQuote", rule: "style/link-title" },
  { source: "requirePragma", issue: 723 },
  { source: "insertPragma", issue: 723 },
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
  { source: "fences", rule: "style/code-fence", defaults: { marker: "`" } },
  { source: "thematic breaks", rule: "style/thematic-break", defaults: { style: "---" } },
  {
    source: "tables",
    rule: "style/table",
    defaults: { style: "aligned", padding: "alignment", pipeStyle: "leadingAndTrailing" },
    issue: 710,
  },
  { source: "trailing spaces", rule: "style/trailing-space", defaults: { hardBreakSpaces: 2 } },
  { source: "blank lines", rule: "style/blank-lines" },
  { source: "block spacing", rule: "style/block-spacing" },
  { source: "final newline", rule: "style/final-newline" },
  { source: "code spans", rule: "style/inline-code" },
  { source: "quote spacing", defaults: {}, issue: 682 },
  { source: "lazy continuations", defaults: {}, issue: 713 },
  { source: "definitions", rule: "style/definition-spacing" },
  { source: "front matter", defaults: {}, issue: 718 },
  { source: "prose spacing", rule: "style/prose-space" },
];

/** Converted configuration with the information needed to review its limits. */
export interface ConversionReport {
  /** Configuration with no implicit preset. */
  config: Config;
  /** Configuration files read by the Node loader; empty for object conversion. */
  sources: string[];
  /** Settings not fully carried over, with tracking issues. */
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
    config: { extends: [], rules },
    sources: [],
    omitted: [],
    conflicts: [],
    suggestions: ["Consider links/valid for local file checking."],
  };
  const owners = new Map<string, string>();
  const set = (row: CompetitorMapping, options: Values, explicit = false) => {
    if (!row.rule) return;
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
          `${row.source}.${key}: value ${JSON.stringify(merged[key])} is outside the mdrefine option range; #${row.issue ?? 669}.`,
        );
        delete merged[key];
      }
    }
    rules[row.rule] = ["warn", merged];
    owners.set(row.rule, row.source);
  };
  if (input.prettier) {
    const p = input.prettier;
    for (const row of competitorMappings.filter((r) => !r.source.startsWith("MD"))) {
      if (row.defaults || (row.rule && !row.options && !["singleQuote"].includes(row.source)))
        set(row, row.defaults ?? {});
      if (row.issue && (row.source in p || row.defaults !== undefined))
        report.omitted.push(`Prettier ${row.source}: incomplete; #${row.issue}.`);
    }
    const rowFor = (source: string) => competitorMappings.find((row) => row.source === source)!;
    set(rowFor("singleQuote"), { delimiter: p.singleQuote === true ? "single" : "double" });
    set(rowFor("tabWidth"), { bulletSpaces: 1, orderedSpaces: 1, nestedIndent: p.tabWidth ?? 2 });
    if (p.proseWrap === "always") set(rowFor("proseWrap"), { width: p.printWidth ?? 80 });
    const known = new Set([
      "printWidth",
      "overrides",
      ...competitorMappings.filter((r) => !r.source.startsWith("MD")).map((r) => r.source),
    ]);
    for (const key of Object.keys(p))
      if (!known.has(key)) report.omitted.push(`Prettier ${key}: no Markdown mapping; #669.`);
    if (p.proseWrap === "never")
      report.omitted.push('Prettier proseWrap: "never": not carried over; #711.');
  }
  if (input.markdownlint) {
    const m = { ...input.markdownlint };
    for (const row of competitorMappings)
      if (row.alias && row.alias in m) {
        m[row.source] = m[row.alias];
        delete m[row.alias];
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
          else report.omitted.push(`${row.source}.${key}: not carried over; #${row.issue ?? 669}.`);
        }
      }
      if (row.source === "MD003") {
        if (["atx_closed", "setext_with_atx_closed"].includes(String(options.style)))
          options.closing = "add";
        if (String(options.style).includes("closed")) options.style = "atx";
        if (String(options.style).startsWith("setext_with")) options.style = "setext";
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
      if (row.source === "MD029")
        options.numbering = ["one", "zero"].includes(String(options.numbering))
          ? "same"
          : options.numbering;
      if (row.source === "MD060" && options.style === "any") {
        delete options.style;
        report.omitted.push("MD060 style:any: a formatter needs a target style; #709.");
      }
      // Competitor defaults enable checks, while explicit choices resolve style conflicts.
      if (input.prettier && setting === undefined && row.rule && rules[row.rule]) continue;
      if (row.source === "MD007" && input.prettier) {
        if (options.nestedIndent !== (input.prettier.tabWidth ?? 2))
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
          `${row.source}: disabled, but ${row.rule} also implements another enabled check; #669.`,
        );
      else {
        rules[row.rule] = "off";
        report.conflicts.push(
          `${row.source}: explicit disable wins over Prettier's fixed ${row.rule} choice.`,
        );
      }
    }
    for (const key of Object.keys(m))
      if (key !== "default" && !competitorMappings.some((r) => r.source === key))
        report.omitted.push(`markdownlint ${key}: unknown rule or option; #669.`);
  }
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
      rules["style/blank-lines"] = ["warn", { ...blankOptions, maximum: count }];
      report.conflicts.push(`MD022 heading spacing wins over MD012: maximum raised to ${count}.`);
    }
  }
  return report;
}
