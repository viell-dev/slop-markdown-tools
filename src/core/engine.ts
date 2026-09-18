import { Ajv } from "ajv";
import type { Nodes } from "mdast";
import { resolveConfig, setting } from "../config/resolve.js";
import { parse } from "../syntax/parse.js";
import { styleRules } from "../rules/style.js";
import { dialectRules } from "../rules/dialects.js";
import { linkRules } from "../rules/links.js";
import { suppressions } from "./directives.js";
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
  Workspace,
} from "./types.js";

export const builtInRules: Record<string, Rule> = { ...styleRules, ...dialectRules, ...linkRules };
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
  const config = resolveConfig(options.config, options.path, options.plugins);
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
function diagnostic(
  source: string,
  rule: string,
  severity: "warn" | "error",
  finding: Finding,
): Diagnostic {
  const prefix = source.slice(0, finding.start);
  return {
    ...finding,
    rule,
    severity,
    line: prefix.split("\n").length,
    column: finding.start - prefix.lastIndexOf("\n"),
  };
}
function inspect(
  document: Document,
  config: ResolvedConfig,
  rules: Record<string, Rule>,
  workspace?: Workspace,
  phase?: string,
): Diagnostic[] {
  const result: Diagnostic[] = [];
  const suppressed = suppressions(document);
  for (const [name, value] of Object.entries(config.rules)) {
    const enabled = setting(value);
    const rule = rules[name]!;
    if (
      enabled.severity === "off" ||
      (phase && (rule.kind !== "style" || (rule.phase ?? "inline") !== phase))
    )
      continue;
    const findings = rule.check({
      document,
      options: enabled.options,
      ...(workspace ? { workspace } : {}),
    });
    for (const finding of findings)
      if (!suppressed(name, finding))
        result.push(diagnostic(document.source, name, enabled.severity, finding));
  }
  return result.sort((a, b) => a.start - b.start || a.rule.localeCompare(b.rule));
}
export function lint(source: string, options: ProcessOptions = {}): Diagnostic[] {
  const { config, rules } = prepare(options);
  const document = parse(source, config.dialect, options.path, options.plugins);
  return inspect(document, config, rules, options.workspace);
}
export function applyEdits(source: string, edits: Edit[]): string {
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
  let output = source;
  for (const edit of accepted.reverse())
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  return output;
}
/** Compare semantic trees, with link identity supplied by the selected renderer's resolver. */
export function semanticFingerprint(document: Document, workspace?: Workspace): string {
  const canonicalUrl = (url: string, wiki = false) => {
    const resolution = workspace?.resolve(document.path, url, document.dialect, wiki);
    return resolution?.status === "resolved"
      ? `${resolution.target}#${resolution.fragment ?? ""}`
      : url;
  };
  function normalize(node: Nodes, calloutHeader = false): unknown {
    if (node.type === "wikiLink") {
      if (node.embed)
        return { type: "embed", url: canonicalUrl(node.target ?? "", true), label: node.label };
      return {
        type: "link",
        url: canonicalUrl(node.target ?? "", true),
        title: null,
        children: [{ type: "text", value: node.label ?? node.target }],
      };
    }
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
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
  return JSON.stringify(normalize(document.tree), (_key, value: unknown) => {
    if (value && typeof value === "object" && !Array.isArray(value))
      return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
    return value;
  });
}
export function format(source: string, options: ProcessOptions = {}): FormatResult {
  const { config, rules } = prepare(options);
  let output = source;
  const initial = parse(source, config.dialect, options.path, options.plugins);
  const fingerprint = semanticFingerprint(initial, options.workspace);
  const seen = new Set([source]);
  try {
    for (let pass = 0; pass < 8; pass++) {
      const before = output;
      for (const phase of ["inline", "block", "document"]) {
        const document = parse(output, config.dialect, options.path, options.plugins);
        const edits = inspect(document, config, rules, options.workspace, phase).flatMap((item) =>
          item.edit ? [item.edit] : [],
        );
        if (!edits.length) continue;
        const candidate = applyEdits(output, edits);
        if (
          semanticFingerprint(
            parse(candidate, config.dialect, options.path, options.plugins),
            options.workspace,
          ) !== fingerprint
        )
          throw new Error(
            `Formatting in the ${phase} phase would change parsed meaning; the document was left unchanged.`,
          );
        output = candidate;
      }
      if (output === before)
        return {
          output,
          changed: output !== source,
          diagnostics: inspect(
            parse(output, config.dialect, options.path, options.plugins),
            config,
            rules,
            options.workspace,
          ),
        };
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
        diagnostic(source, "engine/unsafe-format", "error", {
          start: 0,
          message: error instanceof Error ? error.message : String(error),
        }),
      ],
    };
  }
}
