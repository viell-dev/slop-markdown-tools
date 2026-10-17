import { Ajv } from "ajv";
import type { Nodes } from "mdast";
import { resolveConfig, setting } from "../config/resolve.js";
import { parse, range, splitByteOrderMark } from "../syntax/parse.js";
import { styleRules } from "../rules/style.js";
import { dialectRules } from "../rules/dialects.js";
import { structureRules } from "../rules/structure.js";
import { linkRules } from "../rules/links.js";
import { contentRules } from "../rules/content.js";
import { headingAnchorSource, headingAttributeSource } from "../workspace/heading-attributes.js";
import { suppressions } from "./directives.js";
import { checkRanges, covers, holds, moved, shifted, widen } from "./scope.js";
import type {
  Diagnostic,
  Document,
  Edit,
  Finding,
  FormatResult,
  Plugin,
  ProcessOptions,
  ResolvedConfig,
  Rule,
  SourceRange,
  Workspace,
} from "./types.js";

export const builtInRules: Record<string, Rule> = {
  ...styleRules,
  ...dialectRules,
  ...linkRules,
  ...structureRules,
  ...contentRules,
};
export function ruleRegistry(plugins: Plugin[] = []): Record<string, Rule> {
  const rules = { ...builtInRules };
  const names = new Set<string>();
  for (const plugin of plugins) {
    if (!/^[a-z][a-z\d-]*$/.test(plugin.name) || names.has(plugin.name))
      throw new Error(`Invalid or duplicate plugin name: ${plugin.name}`);
    names.add(plugin.name);
    for (const [name, rule] of Object.entries(plugin.rules ?? {})) {
      const id = `${plugin.name}/${name}`;
      if (rules[id]) throw new Error(`Duplicate rule: ${id}`);
      rules[id] = rule;
    }
  }
  return rules;
}
const ruleValidator = new Ajv({ allErrors: true });
const builtInSchemas = new Set(Object.values(builtInRules).map((rule) => rule.schema));
function prepare(options: ProcessOptions) {
  const config = resolveConfig(
    options.config,
    options.path,
    options.plugins,
    options.defaultDialect,
  );
  const rules = ruleRegistry(options.plugins);
  let pluginValidator: Ajv | undefined;
  for (const [name, value] of Object.entries(config.rules)) {
    const rule = rules[name];
    if (!rule) throw new Error(`Unknown rule: ${name}`);
    const enabled = setting(value);
    if (rule.schema && enabled.severity !== "off") {
      // Plugin schema IDs are scoped to this call; distinct plugin instances
      // may legitimately reuse the same ID with different schemas.
      const validator = builtInSchemas.has(rule.schema)
        ? ruleValidator
        : (pluginValidator ??= new Ajv({ allErrors: true }));
      const validate = validator.compile(rule.schema);
      if (!validate(enabled.options))
        throw new Error(`Invalid options for ${name}: ${validator.errorsText(validate.errors)}`);
    }
  }
  return { config, rules };
}
/** CommonMark's line endings. */
const lineBreaks = /\r\n|\r|\n/g;
/** Offsets where each line starts, computed once per source so findings locate in O(log lines). */
function lineStarts(source: string): number[] {
  const starts = [0];
  for (const match of source.matchAll(lineBreaks)) starts.push(match.index + match[0].length);
  return starts;
}
function diagnostic(
  starts: number[],
  rule: string,
  severity: "warn" | "error",
  finding: Finding,
): Diagnostic {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle]! <= finding.start) low = middle;
    else high = middle - 1;
  }
  return { ...finding, rule, severity, line: low + 1, column: finding.start - starts[low]! + 1 };
}
const sortDiagnostics = (a: Diagnostic, b: Diagnostic) =>
  a.start - b.start || a.rule.localeCompare(b.rule);
function inspect(
  document: Document,
  config: ResolvedConfig,
  rules: Record<string, Rule>,
  workspace?: Workspace,
  include: (rule: Rule) => boolean = () => true,
): Diagnostic[] {
  const result: Diagnostic[] = [];
  const suppressed = suppressions(document);
  const starts = lineStarts(document.source);
  for (const [name, value] of Object.entries(config.rules)) {
    const enabled = setting(value);
    const rule = rules[name]!;
    if (enabled.severity === "off" || !include(rule)) continue;
    const findings = rule.check({
      document,
      options: enabled.options,
      ...(workspace ? { workspace } : {}),
    });
    for (const finding of findings)
      if (!suppressed(name, finding))
        result.push(diagnostic(starts, name, enabled.severity, finding));
  }
  return result.sort(sortDiagnostics);
}
/**
 * Locate diagnostics of a document that `parse` read without the byte order
 * marks it starts with in the text as given, so that their edits apply to that
 * text. Lines and columns stay as they are: the marks are invisible.
 */
function located(diagnostics: Diagnostic[], mark: string): Diagnostic[] {
  if (!mark) return diagnostics;
  const by = mark.length;
  return diagnostics.map((item) => ({
    ...item,
    start: item.start + by,
    ...(item.end !== undefined ? { end: item.end + by } : {}),
    ...(item.edit
      ? { edit: { ...item.edit, start: item.edit.start + by, end: item.edit.end + by } }
      : {}),
  }));
}
export function lint(source: string, options: ProcessOptions = {}): Diagnostic[] {
  if (options.ranges) checkRanges(options.ranges, source);
  const { config, rules } = prepare(options);
  const [mark, text] = splitByteOrderMark(source);
  const document = parse(text, config.dialect, options.path, options.plugins);
  const diagnostics = inspect(document, config, rules, options.workspace);
  // Ranges count the marks, and the document's positions do not.
  const scope =
    options.ranges && widen(document.tree, document.source, shifted(options.ranges, -mark.length));
  return located(
    scope ? diagnostics.filter((item) => covers(scope, item.start)) : diagnostics,
    mark,
  );
}
export function applyEdits(source: string, edits: Edit[]): string {
  const accepted = acceptedEdits(source, edits);
  // Assemble the result in one pass; rebuilding the string per edit is quadratic.
  const parts: string[] = [];
  let cursor = 0;
  for (const edit of accepted) {
    parts.push(source.slice(cursor, edit.start), edit.text);
    cursor = edit.end;
  }
  parts.push(source.slice(cursor));
  return parts.join("");
}
/**
 * The edits that `applyEdits` applies, sorted by position and without repeats
 * of the same edit. An edit outside the source, or overlapping another one, is
 * an error.
 */
function acceptedEdits(source: string, edits: Edit[]): Edit[] {
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let previous: Edit | undefined;
  const accepted: Edit[] = [];
  for (const edit of sorted) {
    if (
      !Number.isInteger(edit.start) ||
      !Number.isInteger(edit.end) ||
      edit.start < 0 ||
      edit.end < edit.start ||
      edit.end > source.length
    )
      throw new Error("Rule returned an invalid edit range.");
    if (
      previous &&
      edit.start === previous.start &&
      edit.end === previous.end &&
      edit.text === previous.text
    )
      continue;
    if (previous && (edit.start < previous.end || edit.start === previous.start))
      throw new Error(
        "Enabled rules proposed overlapping edits; disable one of the conflicting rules.",
      );
    accepted.push(edit);
    previous = edit;
  }
  return accepted;
}
/** Compare semantic trees, with link identity supplied by the selected renderer's resolver. */
export function semanticFingerprint(document: Document, workspace?: Workspace): string {
  const canonicalUrl = (url: string, wiki = false) => {
    const resolution = workspace?.resolve(document.path, url, document.dialect, wiki);
    // A target that is uncertain, because a directory could not be read, is not
    // an identity: only the same spelling is known to name the same note.
    return resolution?.status === "resolved" && !resolution.unreadable
      ? `${resolution.target}#${resolution.fragment ?? ""}`
      : url;
  };
  // Keys are emitted in sorted order so the JSON text is canonical without a replacer.
  function normalize(node: Nodes, calloutHeader = false): unknown {
    if (node.type === "wikiLink") {
      if (node.embed)
        return { label: node.label, type: "embed", url: canonicalUrl(node.target ?? "", true) };
      return {
        children: [{ type: "text", value: node.label ?? node.target }],
        title: null,
        type: "link",
        url: canonicalUrl(node.target ?? "", true),
      };
    }
    const result: Record<string, unknown> = {};
    // Forgejo and Gitea read a heading's trailing `{...}` block as attributes,
    // character for character, where the tree holds ordinary inline content,
    // and generate the anchor from the heading's last line as written.
    if (node.type === "heading") {
      const attributes = headingAttributeSource(document, node);
      if (attributes !== undefined) result.attributes = attributes;
      const anchors = headingAnchorSource(document, node);
      if (anchors !== undefined) result.anchors = anchors;
    }
    if (calloutHeader && document.dialect === "obsidian" && node.type === "paragraph") {
      const [start, end] = range(node);
      const header = document.source.slice(start, end).split(/\r\n|\r|\n/, 1)[0]!;
      if (/^\[![\w-]+\]/.test(header)) {
        // CommonMark merges title and body into one paragraph. Preserve their boundary too.
        const title = header.replace(
          /^\[!([\w-]+)\]/,
          (_, marker: string) => `[!${marker.toLowerCase()}]`,
        );
        result.calloutTitle = normalize(parse(title, document.dialect, document.path).tree);
      }
    }
    for (const key of Object.keys(node).sort()) {
      const value = (node as unknown as Record<string, unknown>)[key];
      if (key === "position" || key === "data") continue;
      if (key === "children" && "children" in node) {
        result.children = node.children.map((child, index) =>
          normalize(child, index === 0 && (node.type === "blockquote" || calloutHeader)),
        );
      } else if (key === "url" && typeof value === "string") result[key] = canonicalUrl(value);
      else if (key === "value" && node.type === "text") {
        let text = node.value.replace(/[ \t\r\n]+/g, " ");
        if (calloutHeader && document.dialect !== "commonmark")
          text = text.replace(
            /^\[!([\w-]+)\]/,
            (_, marker: string) => `[!${marker.toLowerCase()}]`,
          );
        result[key] = text;
      } else if (key === "value" && node.type === "inlineCode")
        result[key] = node.value.replace(/\r\n|\r|\n/g, " ");
      else result[key] = value;
    }
    return result;
  }
  return JSON.stringify(normalize(document.tree));
}
/**
 * Format a document. Byte order marks that it starts with stay in the output
 * and are not part of what the rules see.
 */
export function format(source: string, options: ProcessOptions = {}): FormatResult {
  if (options.ranges) checkRanges(options.ranges, source);
  const [mark, text] = splitByteOrderMark(source);
  // Ranges count the marks, and the document's positions do not.
  const result = formatText(text, options, options.ranges && shifted(options.ranges, -mark.length));
  return {
    output: mark + result.output,
    changed: result.changed,
    diagnostics: located(result.diagnostics, mark),
    ...(result.scope ? { scope: shifted(result.scope, mark.length) } : {}),
  };
}
/** Format a document without byte order marks, limited to `ranges` in its positions. */
function formatText(
  source: string,
  options: ProcessOptions,
  ranges: SourceRange[] | undefined,
): FormatResult {
  const { config, rules } = prepare(options);
  let output = source;
  let document = parse(source, config.dialect, options.path, options.plugins);
  // Where edits may apply, in the positions of the current output.
  const initial = ranges && widen(document.tree, source, ranges);
  let scope = initial;
  // Engine findings concern the whole document and are always reported.
  const reported = (items: Diagnostic[]) =>
    scope
      ? items.filter((item) => item.rule.startsWith("engine/") || covers(scope!, item.start))
      : items;
  // The original fingerprint is only needed once an edit produces a candidate.
  let fingerprint: string | undefined;
  const seen = new Set([source]);
  try {
    for (let pass = 0; pass < 8; pass++) {
      const before = output;
      const findings: Diagnostic[] = [];
      for (const phase of ["inline", "block", "document"]) {
        const diagnostics = inspect(
          document,
          config,
          rules,
          options.workspace,
          (rule) => rule.kind === "style" && (rule.phase ?? "inline") === phase,
        );
        findings.push(...diagnostics);
        // With ranges, an edit that reaches outside them is not applied.
        const edits = diagnostics.flatMap((item) =>
          item.edit && (!scope || holds(scope, item.edit)) ? [item.edit] : [],
        );
        if (!edits.length) continue;
        const accepted = acceptedEdits(output, edits);
        const candidate = applyEdits(output, accepted);
        if (candidate === output) continue;
        const candidateDocument = parse(candidate, config.dialect, options.path, options.plugins);
        fingerprint ??= semanticFingerprint(document, options.workspace);
        if (semanticFingerprint(candidateDocument, options.workspace) !== fingerprint)
          throw new Error(
            `Formatting in the ${phase} phase would change parsed meaning; the document was left unchanged.`,
          );
        output = candidate;
        // Rules consume the document without mutating it. Reuse the validated
        // tree until another phase changes its source, including final diagnostics.
        document = candidateDocument;
        if (scope) scope = moved(scope, accepted);
      }
      if (output === before) {
        // No phase changed the document, so every style finding of this pass
        // describes the final document; only the non-style rules still need to run.
        const remaining = inspect(
          document,
          config,
          rules,
          options.workspace,
          (rule) => rule.kind !== "style",
        );
        return {
          output,
          changed: output !== source,
          diagnostics: reported([...findings, ...remaining]).sort(sortDiagnostics),
          ...(scope ? { scope } : {}),
        };
      }
      if (seen.has(output))
        throw new Error("Formatting rules oscillate; the document was left unchanged.");
      seen.add(output);
    }
    throw new Error(
      "Formatting did not converge in eight passes; the document was left unchanged.",
    );
  } catch (error) {
    return {
      output: source,
      changed: false,
      diagnostics: [
        diagnostic([0], "engine/unsafe-format", "error", {
          start: 0,
          message: error instanceof Error ? error.message : String(error),
        }),
      ],
      ...(initial ? { scope: initial } : {}),
    };
  }
}
