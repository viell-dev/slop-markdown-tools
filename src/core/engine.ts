import { Ajv } from "ajv";
import type { AnySchema, ValidateFunction } from "ajv";
import type { Nodes } from "mdast";
import { resolveConfig, setting } from "../config/resolve.js";
import { parse, range, splitByteOrderMark } from "../syntax/parse.js";
import { styleRules } from "../rules/style.js";
import { blockRules } from "../rules/blocks.js";
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
  ...blockRules,
  ...dialectRules,
  ...linkRules,
  ...structureRules,
  ...contentRules,
};
const phases = ["inline", "block", "document"] as const;
/** A short description of a value that a plugin gave where something else belongs. */
function shown(value: unknown): string {
  switch (typeof value) {
    case "string":
      return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
    case "number":
    case "bigint":
    case "boolean":
    case "undefined":
      return String(value);
    case "function":
      return "a function";
    case "symbol":
      return "a symbol";
    default:
      return value === null ? "null" : Array.isArray(value) ? "a list" : "an object";
  }
}
/** What is wrong with a plugin's rule, or undefined when it has the shape of a `Rule`. */
function ruleProblem(rule: unknown): string | undefined {
  if (!rule || typeof rule !== "object") return `it is ${shown(rule)}, not an object`;
  const { check, kind, phase, description, schema } = rule as Record<string, unknown>;
  if (typeof check !== "function") return `its check is ${shown(check)}, not a function`;
  if (kind !== "style" && kind !== "problem")
    return `its kind is ${shown(kind)}, not "style" or "problem"`;
  if (phase !== undefined && !(phases as readonly unknown[]).includes(phase))
    return `its phase is ${shown(phase)}, not "inline", "block", or "document"`;
  if (typeof description !== "string")
    return `its description is ${shown(description)}, not a string`;
  if (
    schema !== undefined &&
    typeof schema !== "boolean" &&
    (!schema || typeof schema !== "object" || Array.isArray(schema))
  )
    return `its schema is ${shown(schema)}, not a JSON Schema`;
  return undefined;
}
/**
 * The built-in rules and those of `plugins`, by rule ID. A plugin rule that
 * does not have the shape of a `Rule` is an error that names it.
 */
export function ruleRegistry(plugins: Plugin[] = []): Record<string, Rule> {
  const rules = { ...builtInRules };
  const names = new Set<string>();
  for (const plugin of plugins) {
    if (!/^[a-z][a-z\d-]*$/.test(plugin.name) || names.has(plugin.name))
      throw new Error(`Invalid or duplicate plugin name: ${plugin.name}`);
    names.add(plugin.name);
    for (const [name, rule] of Object.entries(plugin.rules ?? {})) {
      const id = `${plugin.name}/${name}`;
      if (Object.hasOwn(rules, id)) throw new Error(`Duplicate rule: ${id}`);
      const problem = ruleProblem(rule);
      if (problem) throw new Error(`Invalid rule ${id}: ${problem}.`);
      rules[id] = rule;
    }
  }
  return rules;
}
/** Checks the options of built-in rules, whose schemas have no `$id` that could collide. */
const ruleValidator = new Ajv({ allErrors: true });
const builtInSchemas = new Set(Object.values(builtInRules).map((rule) => rule.schema));
/**
 * Each option schema compiled once, however many documents use it. A plugin
 * schema gets a validator of its own, because distinct plugins may
 * legitimately reuse an `$id` with different schemas.
 */
const compiledSchemas = new WeakMap<object, ValidateFunction>();
function optionsValidator(name: string, schema: AnySchema): ValidateFunction {
  // Ajv keeps compiled boolean schemas itself.
  if (typeof schema !== "object") return ruleValidator.compile(schema);
  let validate = compiledSchemas.get(schema);
  if (!validate) {
    try {
      validate = (
        builtInSchemas.has(schema) ? ruleValidator : new Ajv({ allErrors: true })
      ).compile(schema);
    } catch (error) {
      throw new Error(
        `Invalid rule ${name}: its schema cannot be compiled: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
    compiledSchemas.set(schema, validate);
  }
  return validate;
}
function prepare(options: ProcessOptions) {
  const config = resolveConfig(
    options.config,
    options.path,
    options.plugins,
    options.defaultDialect,
  );
  const rules = ruleRegistry(options.plugins);
  for (const [name, value] of Object.entries(config.rules)) {
    // Names such as `toString` are found on every object; only defined rules count.
    if (!Object.hasOwn(rules, name)) throw new Error(`Unknown rule: ${name}`);
    const rule = rules[name]!;
    const enabled = setting(value);
    if (rule.schema && enabled.severity !== "off") {
      const validate = optionsValidator(name, rule.schema);
      if (!validate(enabled.options))
        throw new Error(
          `Invalid options for ${name}: ${ruleValidator.errorsText(validate.errors)}`,
        );
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
/** Diagnostics of the engine itself; they concern the whole document. */
const fromEngine = (item: Diagnostic) => item.rule.startsWith("engine/");
/** Why `value` is not an offset from `from` to `to`, or undefined when it is one. */
function offsetProblem(what: string, value: unknown, from: number, to: number) {
  return Number.isInteger(value) && (value as number) >= from && (value as number) <= to
    ? undefined
    : `${what} is ${shown(value)}, not an offset from ${from} to ${to}`;
}
/**
 * What is wrong with the findings that a rule returned for a source of
 * `length` UTF-16 units, as the rest of a sentence about the rule, or
 * undefined when every finding can be reported and every edit applied.
 */
function findingsProblem(findings: unknown, length: number): string | undefined {
  if (!Array.isArray(findings)) return `returned ${shown(findings)} instead of a list of findings`;
  for (const finding of findings as unknown[]) {
    if (!finding || typeof finding !== "object")
      return `returned a finding that is ${shown(finding)}, not an object`;
    const { message, start, end, edit } = finding as Record<string, unknown>;
    const problem =
      (typeof message === "string"
        ? undefined
        : `whose message is ${shown(message)}, not a string`) ??
      offsetProblem("whose start", start, 0, length) ??
      (end === undefined ? undefined : offsetProblem("whose end", end, start as number, length)) ??
      (edit === undefined || (edit && typeof edit === "object")
        ? undefined
        : `whose edit is ${shown(edit)}, not an object`);
    if (problem) return `returned a finding ${problem}`;
    if (edit === undefined) continue;
    const { start: from, end: to, text } = edit as Record<string, unknown>;
    const invalid =
      offsetProblem("whose start", from, 0, length) ??
      offsetProblem("whose end", to, from as number, length) ??
      (typeof text === "string" ? undefined : `whose text is ${shown(text)}, not a string`);
    if (invalid) return `returned an edit ${invalid}`;
  }
  return undefined;
}
/**
 * `workspace` as rules see it. What its `resolve` throws is added to `errors`:
 * such an error is the host's, such as a file that could not be read, and not
 * the rule's. Rules still see it as it was thrown.
 */
function guarded(workspace: Workspace, errors: Set<unknown>): Workspace {
  const resolve: Workspace["resolve"] = (...query) => {
    try {
      return workspace.resolve(...query);
    } catch (error) {
      errors.add(error);
      throw error;
    }
  };
  // Other members, such as a host's own, reach the workspace itself.
  return new Proxy(workspace, {
    get(target, key) {
      if (key === "resolve") return resolve;
      const value: unknown = Reflect.get(target, key);
      return typeof value === "function" ? (value as () => unknown).bind(target) : value;
    },
  });
}
/** A thrown value as text, without letting it throw again. */
function failure(error: unknown): string {
  try {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  } catch {
    return "a value that cannot be shown";
  }
}
/**
 * The diagnostics of the enabled rules that `include` selects. A rule that
 * throws, or returns something that is not a list of valid findings, is
 * skipped for the document and reported as `engine/rule-error` instead. An
 * error of the workspace itself, such as a file that could not be read, is
 * not the rule's and is thrown on.
 */
function inspect(
  document: Document,
  config: ResolvedConfig,
  rules: Record<string, Rule>,
  host?: Workspace,
  include: (rule: Rule) => boolean = () => true,
): Diagnostic[] {
  const result: Diagnostic[] = [];
  const suppressed = suppressions(document);
  const starts = lineStarts(document.source);
  const hostErrors = new Set<unknown>();
  const workspace = host && guarded(host, hostErrors);
  for (const [name, value] of Object.entries(config.rules)) {
    const enabled = setting(value);
    const rule = rules[name]!;
    if (enabled.severity === "off" || !include(rule)) continue;
    let findings: Finding[] = [];
    let problem: string | undefined;
    try {
      const returned: unknown = rule.check({
        document,
        options: enabled.options,
        ...(workspace ? { workspace } : {}),
      });
      problem = findingsProblem(returned, document.source.length);
      if (!problem) findings = returned as Finding[];
    } catch (error) {
      if (hostErrors.has(error)) throw error;
      problem = `failed (${failure(error)})`;
    }
    if (problem) {
      result.push(
        diagnostic([0], "engine/rule-error", "error", {
          start: 0,
          message: `Rule ${name} ${problem}; the rule was skipped for this document.`,
        }),
      );
      continue;
    }
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
    scope
      ? diagnostics.filter((item) => fromEngine(item) || covers(scope, item.start))
      : diagnostics,
    mark,
  );
}
export function applyEdits(source: string, edits: Edit[]): string {
  return splice(source, acceptedEdits(source, edits));
}
/** `source` with `edits`, which are sorted and do not overlap, applied. */
function splice(source: string, edits: readonly Edit[]): string {
  // Assemble the result in one pass; rebuilding the string per edit is quadratic.
  const parts: string[] = [];
  let cursor = 0;
  for (const edit of edits) {
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
  return JSON.stringify(semanticTree(document, workspace));
}
/**
 * The document's meaning as plain data whose keys are in sorted order. With
 * `origins`, each object of the result that stands for a node of the document
 * is mapped to that node.
 */
function semanticTree(
  document: Document,
  workspace?: Workspace,
  origins?: Map<unknown, Nodes>,
): unknown {
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
      const link = node.embed
        ? { label: node.label, type: "embed", url: canonicalUrl(node.target ?? "", true) }
        : {
            children: [{ type: "text", value: node.label ?? node.target }],
            title: null,
            type: "link",
            url: canonicalUrl(node.target ?? "", true),
          };
      origins?.set(link, node);
      return link;
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
    origins?.set(result, node);
    return result;
  }
  return normalize(document.tree);
}
/** A part of a semantic tree that has children. */
type Branch = Record<string, unknown> & { children: unknown[] };
const isBranch = (value: unknown): value is Branch =>
  typeof value === "object" && value !== null && Array.isArray((value as Branch).children);
/**
 * Where the meaning of `after` first differs from that of `before`, as an
 * offset into `before`'s source: the start of the first node, in document
 * order, whose meaning is not the same, or the end of the node that `after`
 * gives more content.
 */
function divergence(before: Document, after: Document, workspace?: Workspace): number {
  const origins = new Map<unknown, Nodes>();
  let a = semanticTree(before, workspace, origins);
  let b = semanticTree(after, workspace);
  let offset = 0;
  for (;;) {
    const node = origins.get(a);
    // A node made up for the comparison, or one without a position, is placed at its parent.
    offset = node?.position?.start.offset ?? offset;
    if (!isBranch(a) || !isBranch(b)) return offset;
    const own = (value: Branch) => JSON.stringify({ ...value, children: undefined });
    if (own(a) !== own(b)) return offset;
    const { children } = b;
    const index = a.children.findIndex(
      (child, at) => JSON.stringify(child) !== JSON.stringify(children[at]),
    );
    if (index < 0) return node?.position?.end.offset ?? offset;
    a = a.children[index];
    b = children[index];
  }
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
/** An edit that a rule proposed, with the rule's ID. */
interface Proposal extends Edit {
  rule: string;
}
const byPosition = (a: Edit, b: Edit) => a.start - b.start || a.end - b.end;
/**
 * The proposals to apply together, in the order of the source. An edit that
 * overlaps one before it, or repeats it, is left out; the next pass, which
 * runs the rules again on the changed text, reconsiders it.
 */
function compatible(proposals: readonly Proposal[]): Proposal[] {
  const result: Proposal[] = [];
  let previous: Proposal | undefined;
  for (const edit of [...proposals].sort(byPosition)) {
    if (previous && (edit.start < previous.end || edit.start === previous.start)) continue;
    result.push(edit);
    previous = edit;
  }
  return result;
}
/** Rule IDs as a list in prose. */
function listed(names: Iterable<string>): string {
  const items = [...names];
  return items.length < 3
    ? items.join(" and ")
    : `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}
/**
 * Format a document without byte order marks, limited to `ranges` in its
 * positions. Each phase applies the edits of its rules together when the
 * result means what the original document means. Otherwise it adds the rules'
 * edits one rule at a time and leaves out the edits of each rule that would
 * change the meaning; the result reports each such rule with the place where
 * the meaning would first differ. Passes repeat until one changes nothing;
 * formatting that does not settle leaves the whole document unchanged.
 */
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
    scope ? items.filter((item) => fromEngine(item) || covers(scope!, item.start)) : items;
  const unchanged = (message: string): FormatResult => ({
    output: source,
    changed: false,
    diagnostics: [diagnostic([0], "engine/unsafe-format", "error", { start: 0, message })],
    ...(initial ? { scope: initial } : {}),
  });
  // The original fingerprint is only needed once an edit produces a candidate.
  let fingerprint: string | undefined;
  /** `candidate` parsed, and whether it means what the original document means. */
  const check = (candidate: string) => {
    const parsed = parse(candidate, config.dialect, options.path, options.plugins);
    // Every document accepted so far means what the original means, so the current one serves.
    fingerprint ??= semanticFingerprint(document, options.workspace);
    return {
      document: parsed,
      safe: semanticFingerprint(parsed, options.workspace) === fingerprint,
    };
  };
  const seen = new Set([source]);
  /** The rules whose edits changed the document in the latest pass. */
  let applied = new Set<string>();
  try {
    for (let pass = 0; pass < 8; pass++) {
      const before = output;
      const findings: Diagnostic[] = [];
      applied = new Set();
      /** The rules whose edits this pass left out, with the document before and after them. */
      const refused: { rule: string; before: Document; after: Document }[] = [];
      const accept = (edits: Proposal[], text: string, parsed: Document) => {
        output = text;
        // Rules consume the document without mutating it. Reuse the validated
        // tree until another phase changes its source, including final diagnostics.
        document = parsed;
        if (scope) scope = moved(scope, edits);
        for (const edit of edits) applied.add(edit.rule);
      };
      for (const phase of phases) {
        const diagnostics = inspect(
          document,
          config,
          rules,
          options.workspace,
          (rule) => rule.kind === "style" && (rule.phase ?? "inline") === phase,
        );
        findings.push(...diagnostics);
        // With ranges, an edit that reaches outside them is not applied. One
        // that changes nothing need not be tried, and must not hold others back.
        const proposals: Proposal[] = [];
        for (const { edit, rule } of diagnostics)
          if (
            edit &&
            (!scope || holds(scope, edit)) &&
            output.slice(edit.start, edit.end) !== edit.text
          )
            proposals.push({ start: edit.start, end: edit.end, text: edit.text, rule });
        // The rules of this phase whose edits would change the meaning.
        const excluded = new Set<string>();
        for (;;) {
          const edits = compatible(proposals.filter((edit) => !excluded.has(edit.rule)));
          if (!edits.length) break;
          const candidate = splice(output, edits);
          if (candidate === output) break;
          const tried = check(candidate);
          if (tried.safe) {
            accept(edits, candidate, tried.document);
            break;
          }
          // Taken only when a phase fails, so the usual path parses each candidate once.
          let kept: Proposal[] = [];
          let keptOutput = output;
          let keptDocument = document;
          for (const rule of new Set(edits.map((edit) => edit.rule))) {
            const trial = [...kept, ...edits.filter((edit) => edit.rule === rule)].sort(byPosition);
            // All the edits together are already known to fail.
            const whole = trial.length === edits.length;
            const text = whole ? candidate : splice(output, trial);
            const result = whole ? tried : check(text);
            if (result.safe) {
              kept = trial;
              keptOutput = text;
              keptDocument = result.document;
            } else {
              excluded.add(rule);
              refused.push({ rule, before: document, after: result.document });
            }
          }
          if (keptOutput !== output) {
            accept(kept, keptOutput, keptDocument);
            break;
          }
          // Nothing was kept: the edits that overlapped refused ones get their turn.
        }
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
        // A refusal of this pass was tried on the final text, unless one
        // phase undid what an earlier one did.
        const starts = refused.length ? lineStarts(output) : [];
        const refusals = refused.map(({ rule, before: tried, after }) => {
          const start = tried.source === output ? divergence(tried, after, options.workspace) : 0;
          const { line } = diagnostic(starts, rule, "error", { start, message: "" });
          return diagnostic(starts, "engine/unsafe-format", "error", {
            start,
            message: `${rule} would change the parsed meaning at line ${line}; none of its edits were applied.`,
          });
        });
        return {
          output,
          changed: output !== source,
          diagnostics: reported([...findings, ...remaining, ...refusals]).sort(sortDiagnostics),
          ...(scope ? { scope } : {}),
        };
      }
      if (seen.has(output))
        return unchanged(
          `Formatting by ${listed(applied)} oscillates; the document was left unchanged.`,
        );
      seen.add(output);
    }
    return unchanged(
      `Formatting by ${listed(applied)} did not converge in eight passes; the document was left unchanged.`,
    );
  } catch (error) {
    return unchanged(error instanceof Error ? error.message : String(error));
  }
}
