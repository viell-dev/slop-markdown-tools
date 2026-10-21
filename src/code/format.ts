import path from "node:path";
import type { Code } from "mdast";
import { Minimatch } from "minimatch";
import {
  format,
  lint,
  applyEdits,
  semanticFingerprint,
  semanticFingerprintWithCode,
} from "../core/engine.js";
import { diagnostic, sortDiagnostics } from "../core/diagnostics.js";
import { resolveConfig, setting } from "../config/resolve.js";
import type { Diagnostic, Document, Edit, FormatResult, ProcessOptions } from "../core/types.js";
import { suppressions } from "../core/directives.js";
import { covers, holds, moved } from "../core/scope.js";
import { parse, otherReading, range, splitByteOrderMark } from "../syntax/parse.js";
import { codeFence } from "../syntax/fences.js";
import { lineEnding, lineStarts } from "../syntax/source.js";
import { walk } from "../syntax/walk.js";
import { codeEdits } from "./fences.js";
import { runFormatter } from "./command.js";

/** Node host options for Markdown formatting and explicitly configured code tools. */
export interface CodeFormatOptions extends ProcessOptions {
  /** Working directory and local executable context; process.cwd() when omitted. */
  cwd?: string | undefined;
}
const engineRule = "engine/code-formatter";
const isEngine = (item: Diagnostic) => item.rule.startsWith("engine/");
function blocks(document: Document): Code[] {
  const found: Code[] = [];
  walk(document.tree, "code", (node) => found.push(node));
  return found;
}
function approvedValues(document: Document, node: Code, value: string): WeakMap<Code, string> {
  const approved = new WeakMap<Code, string>([[node, value]]);
  const reading = otherReading(document.tree);
  if (reading) {
    const [start, end] = range(node);
    walk(reading, "code", (other) => {
      const [from, to] = range(other);
      if (
        from === start &&
        to === end &&
        other.lang === node.lang &&
        other.meta === node.meta &&
        other.value === node.value
      )
        approved.set(other, value);
    });
  }
  return approved;
}
/** An engine finding moved by one accepted whole-block replacement. */
function movedDiagnostic(item: Diagnostic, edit: Edit): Diagnostic {
  const at = (offset: number) =>
    offset < edit.start
      ? offset
      : offset >= edit.end
        ? offset + edit.text.length - (edit.end - edit.start)
        : edit.start;
  return {
    ...item,
    start: at(item.start),
    ...(item.end === undefined ? {} : { end: at(item.end) }),
    ...(item.edit
      ? { edit: { ...item.edit, start: at(item.edit.start), end: at(item.edit.end) } }
      : {}),
  };
}

/** Format Markdown, then selected fenced code with trusted, configured commands. */
export async function formatWithCode(
  source: string,
  options: CodeFormatOptions = {},
): Promise<FormatResult> {
  const first = format(source, options);
  const config = resolveConfig(options);
  if (!config.codeFormatters.length || first.scope?.length === 0) return first;
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const filename = path.resolve(cwd, options.path ?? "document.md");
  const named = (options.path ?? "document.md").replaceAll("\\", "/");
  const routes = config.codeFormatters.map((formatter) => ({
    formatter,
    excluded: (formatter.exclude ?? []).some((pattern) =>
      new Minimatch(pattern, { dot: true }).match(named),
    ),
  }));
  const route = (language: string): (typeof routes)[number] | undefined =>
    routes.find(({ formatter }) => formatter.languages.includes(language)) ??
    routes.find(
      ({ formatter }) => formatter.languages.length === 1 && formatter.languages[0] === "*",
    );
  let output = first.output;
  const mark = splitByteOrderMark(output)[0];
  let document = parse(output, config.dialect, options.path, options.plugins);
  let nodes = blocks(document);
  let suppressed = suppressions(document);
  let scope = first.scope;
  let reported = first.diagnostics.filter(isEngine);
  const normalizeFence = setting(config.rules["style/code-fence"] ?? "off").severity !== "off";
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!;
    const language = node.lang;
    const fence = codeFence(document.source, node);
    if (!fence || fence.marker === "$" || !language || /\s/.test(language)) continue;
    const selected = route(language);
    if (!selected || selected.excluded) continue;
    const [start, end] = range(node);
    const extent = { start: start + mark.length, end: end + mark.length, text: "" };
    if (
      (scope && !holds(scope, extent)) ||
      suppressed(engineRule, { start, end, edit: { start, end, text: "" }, message: "" })
    )
      continue;
    const fail = (reason: string) =>
      reported.push(
        diagnostic(lineStarts(output), engineRule, "error", {
          start: extent.start,
          end: extent.end,
          message: `Code formatter ${JSON.stringify(selected.formatter.id)} ${reason}; this block was left unchanged.`,
        }),
      );
    let formatted: string;
    try {
      formatted = await runFormatter(
        selected.formatter,
        node.value + lineEnding(document.source),
        cwd,
        filename,
      );
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
      continue;
    }
    const candidate = codeEdits(
      document,
      node,
      formatted,
      normalizeFence &&
        !suppressed("style/code-fence", {
          start,
          end,
          edit: { start, end, text: "" },
          message: "",
        }),
    );
    if (!candidate || candidate.value === node.value) continue;
    const expected = semanticFingerprintWithCode(
      document,
      approvedValues(document, node, candidate.value),
      options.workspace,
    );
    let accepted = false;
    for (const edits of candidate.choices) {
      const bare = applyEdits(document.source, edits);
      const tried = parse(bare, config.dialect, options.path, options.plugins);
      if (semanticFingerprint(tried, options.workspace) !== expected) continue;
      const full = edits.map((edit) => ({
        ...edit,
        start: edit.start + mark.length,
        end: edit.end + mark.length,
      }));
      for (const edit of full) reported = reported.map((item) => movedDiagnostic(item, edit));
      if (scope) scope = moved(scope, full);
      output = mark + bare;
      document = tried;
      nodes = blocks(document);
      suppressed = suppressions(document);
      accepted = true;
      break;
    }
    if (!accepted)
      fail("returned output that could not be inserted while preserving the surrounding Markdown");
  }
  const starts = lineStarts(output);
  reported = reported.map((item) => {
    const located = diagnostic(starts, item.rule, item.severity, item);
    // Offsets include encoding marks; columns follow the core's visible text.
    if (located.line === 1) located.column -= mark.length;
    if (located.rule === "engine/unsafe-format")
      located.message = located.message.replace(
        / at line \d+; none of its edits were applied\.$/,
        ` at line ${located.line}; none of its edits were applied.`,
      );
    return located;
  });
  const remaining =
    output === first.output
      ? first.diagnostics.filter((item) => !isEngine(item))
      : lint(output, { ...options, ranges: undefined }).filter(
          (item) => isEngine(item) || !scope || covers(scope, item.start),
        );
  const unique = new Map<string, Diagnostic>();
  for (const item of [...remaining, ...reported])
    unique.set(
      JSON.stringify([
        item.rule,
        item.severity,
        item.start,
        item.end,
        item.message,
        item.edit?.start,
        item.edit?.end,
        item.edit?.text,
      ]),
      item,
    );
  return {
    output,
    changed: output !== source,
    diagnostics: [...unique.values()].sort(sortDiagnostics),
    ...(scope ? { scope } : {}),
  };
}
