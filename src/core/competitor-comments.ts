import { sourceChecks, type AttributedFinding } from "./source-checks.js";
import { Minimatch } from "minimatch";
import { convertConfig, competitorMappings } from "../config/convert.js";
import { resolveConfig } from "../config/resolve.js";
import { range } from "../syntax/parse.js";
import { lineStarts } from "../syntax/source.js";
import { walk } from "../syntax/walk.js";
import type { Document, Edit, Finding, ProcessOptions, RuleSetting } from "./types.js";

function names(name: string) {
  const key = name.toLowerCase();
  return competitorMappings.filter(
    (row) =>
      row.source.startsWith("MD") &&
      (row.source.toLowerCase() === key ||
        row.alias === key ||
        row.aliases?.includes(key) ||
        row.tags?.includes(key)),
  );
}
function comments(document: Document) {
  const result: {
    value: string;
    start: number;
    end: number;
    top: boolean;
    next?: [number, number];
  }[] = [];
  walk(document.tree, "html", (node, index, parent) => {
    const [start, end] = range(node);
    for (const match of node.value.matchAll(/<!--[\s\S]*?-->/g)) {
      const to = start + match.index + match[0].length;
      const next = parent?.children[(index ?? -1) + 1];
      result.push({
        value: match[0],
        start: start + match.index,
        end: to,
        top: parent?.type === "root",
        ...(end > to ? { next: [to, end] as [number, number] } : next ? { next: range(next) } : {}),
      });
    }
  });
  return result.sort((a, b) => a.start - b.start);
}
/** File-wide JSON is converted with the same mapping as the original data. */
export function configuredComments(document: Document, options: ProcessOptions): ProcessOptions {
  if (options.onCompatibilityWarning) {
    const emit = options.onCompatibilityWarning;
    const seen = new Set<string>();
    options = {
      ...options,
      onCompatibilityWarning: (message) => {
        if (!seen.has(message)) {
          seen.add(message);
          emit(message);
        }
      },
    };
  }
  const compat = options.compatibility;
  if (!compat?.markdownlint || !document.source.includes("markdownlint-configure-file"))
    return options;
  const canonical = (values: Record<string, unknown>) => {
    const result: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(values)) {
      const rows = names(name);
      if (rows.length) for (const row of rows) result[row.source] = value;
      else result[name.toLowerCase()] = value;
    }
    return result;
  };
  let markdownlint = canonical(compat.markdownlint);
  for (const comment of comments(document)) {
    const match = /^<!--\s*markdownlint-configure-file\s+([\s\S]*?)\s*-->$/.exec(comment.value);
    if (!match) continue;
    try {
      const value: unknown = JSON.parse(match[1]!);
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Expected an object");
      markdownlint = { ...markdownlint, ...canonical(value as Record<string, unknown>) };
    } catch {
      options.onCompatibilityWarning?.(
        "Invalid markdownlint-configure-file JSON; comment ignored.",
      );
    }
  }
  const report = convertConfig({
    markdownlint,
    ...(compat.prettier ? { prettier: compat.prettier } : {}),
  });
  for (const message of report.omitted) options.onCompatibilityWarning?.(message);
  return {
    ...options,
    config: { ...options.config, rules: report.config.rules ?? {} },
    compatibility: {
      ...report.compatibility,
      origins: Object.fromEntries(
        [
          ...new Set([
            ...Object.keys(compat.origins),
            ...Object.keys(report.compatibility.origins),
          ]),
        ].map((rule) => [
          rule,
          [
            ...new Set([
              ...(report.compatibility.origins[rule] ?? []),
              ...(compat.origins[rule] ?? []).filter((id) => !id.startsWith("MD")),
            ]),
          ],
        ]),
      ),
      pragmaOverrides: compat.pragmaOverrides ?? [],
    },
  };
}
type CompatibleFinding = Finding & { compatibilitySeverity?: "warn" };
type Interval = { start: number; end: number };
function merged(intervals: Interval[]): Interval[] {
  const result: Interval[] = [];
  for (const interval of intervals.sort((a, b) => a.start - b.start)) {
    const last = result.at(-1);
    if (last && interval.start <= last.end) last.end = Math.max(last.end, interval.end);
    else result.push({ ...interval });
  }
  return result;
}
/** Binary lookup avoids scanning every comment for each finding. */
function intersects(intervals: Interval[], start: number, end: number): boolean {
  let low = 0;
  let high = intervals.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (intervals[mid]!.end < start) low = mid + 1;
    else high = mid;
  }
  return low < intervals.length && intervals[low]!.start <= end;
}
export function competitorComments(document: Document, options: ProcessOptions) {
  const compat = options.compatibility;
  const emptyVariants: Record<string, RuleSetting[]> = {};
  if (!compat)
    return Object.assign(
      (_rule: string, finding: Finding): CompatibleFinding | undefined => finding,
      {
        variants: emptyVariants,
        prepare: (rule: string, findings: (Finding & { variant?: RuleSetting })[]) => {
          void rule;
          void findings;
        },
      },
    );
  const effectiveRules = resolveConfig({
    config: options.config ?? {},
    ...(options.path ? { path: options.path } : {}),
    ...(options.plugins ? { plugins: options.plugins } : {}),
  }).rules;
  const source = document.source;
  const starts = lineStarts(source);
  const lineAt = (offset: number) => {
    let low = 0;
    let high = starts.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (starts[mid]! <= offset) low = mid + 1;
      else high = mid;
    }
    return low - 1;
  };
  const found = comments(document);
  const prettierRanges: Interval[] = [];
  let requirePragma = compat.prettier?.requirePragma === true;
  for (const override of compat.pragmaOverrides ?? [])
    if (override.files.some((p) => new Minimatch(p, { dot: true }).match(options.path ?? "")))
      requirePragma = override.requirePragma;
  // Prettier recognizes YAML (including ... closers) and TOML before a pragma.
  const header = /^(---|\+\+\+)([^\r\n]*)\r?\n/.exec(source);
  let body = source;
  if (header) {
    const marker = header[1]!;
    const language = header[2]!.trim() || (marker === "---" ? "yaml" : "toml");
    const closing = new RegExp(
      `\\r?\\n(?:${marker === "---" ? "---" : "\\+\\+\\+"}${language === "yaml" ? "|\\.\\.\\." : ""})[^\\S\\r\\n]*(?:\\r?\\n|$)`,
    );
    const end = closing.exec(source.slice(header[0].length - 1));
    if (end) body = source.slice(header[0].length - 1 + end.index + end[0].length);
  }
  const pragma =
    /^(?:<!--\s*@(format|prettier)\s*-->|<!--[^\n]*\n[\s\S]*?(?:^|\n)[^\S\n]*@(format|prettier)[^\S\n]*(?:$|\n)[\s\S]*?\n[^\n]*-->)/m;
  if (requirePragma && body.trimStart().match(pragma)?.index !== 0)
    prettierRanges.push({ start: 0, end: source.length });
  let open: number | undefined;
  for (const comment of found) {
    if (/^<!--\s*prettier-ignore\s*-->$/.test(comment.value) && comment.next)
      prettierRanges.push({ start: comment.next[0], end: comment.next[1] });
    const line = lineAt(comment.start);
    const blankBefore = line === 0 || /^\s*$/.test(source.slice(starts[line - 1], starts[line]));
    if (!comment.top || !blankBefore) continue;
    if (/^<!--\s*prettier-ignore-start\s*-->$/.test(comment.value)) open ??= comment.start;
    if (/^<!--\s*prettier-ignore-end\s*-->$/.test(comment.value) && open !== undefined) {
      prettierRanges.push({ start: open, end: comment.end });
      open = undefined;
    }
  }
  const prettier = merged(prettierRanges);
  const events = found.flatMap((comment) => {
    const match =
      /^<!--\s*markdownlint-(disable-next-line|disable-line|disable-file|enable-file|disable|enable|capture|restore)(?:\s+([\s\S]*?))?\s*-->$/.exec(
        comment.value,
      );
    if (!match) return [];
    const selected = new Set<string>();
    const tokens = match[2]?.trim().split(/\s+/).filter(Boolean) ?? [];
    for (const token of tokens) {
      const rows = names(token);
      if (!rows.length)
        options.onCompatibilityWarning?.(
          `markdownlint comment ${token}: no counterpart (unknown rule or tag).`,
        );
      for (const row of rows) {
        if (row.rule) selected.add(row.source);
        else
          options.onCompatibilityWarning?.(
            `markdownlint comment ${token}: no counterpart; ${row.issue ? `#${row.issue}` : "no equivalent rule"}.`,
          );
      }
    }
    return [
      {
        ...comment,
        line: lineAt(comment.start),
        kind: match[1]!,
        selected: tokens.length ? selected : undefined,
      },
    ];
  });
  const positionalRanges = merged(
    events
      .filter(
        (event) =>
          event.kind === "disable-next-line" &&
          Object.values(compat.origins).some((origins) =>
            origins.some(
              (id) => id.startsWith("MD") && (!event.selected || event.selected.has(id)),
            ),
          ),
      )
      .map((event) => ({ start: event.end, end: starts[event.line + 1] ?? event.end })),
  );
  const cache = new Map<string, Interval[]>();
  function suppressed(id: string, position: number, end = position) {
    let intervals = cache.get(id);
    if (!intervals) {
      const relevant = (event: (typeof events)[number]) =>
        !event.selected || event.selected.has(id);
      let enabled = true;
      for (const event of events)
        if (relevant(event)) {
          if (event.kind === "disable-file") enabled = false;
          if (event.kind === "enable-file") enabled = true;
        }
      let captured = enabled;
      let active = enabled ? undefined : 0;
      intervals = [];
      for (const event of events) {
        if (!relevant(event)) continue;
        const at = starts[event.line]!;
        if (event.kind === "disable-line" || event.kind === "disable-next-line") {
          const line = event.line + (event.kind === "disable-next-line" ? 1 : 0);
          if (starts[line] !== undefined)
            intervals.push({
              start: starts[line],
              end: (starts[line + 1] ?? source.length + 1) - 1,
            });
          continue;
        }
        if (event.kind === "capture") {
          captured = enabled;
          continue;
        }
        if (!["disable", "enable", "restore"].includes(event.kind)) continue;
        const next = event.kind === "restore" ? captured : event.kind === "enable";
        if (enabled && !next) active = at;
        if (!enabled && next && active !== undefined) {
          if (at > active) intervals.push({ start: active, end: at - 1 });
          active = undefined;
        }
        enabled = next;
      }
      if (active !== undefined) intervals.push({ start: active, end: source.length });
      intervals = merged(intervals);
      cache.set(id, intervals);
    }
    return intersects(intervals, position, end);
  }
  // Partition at suppression transitions, then convert each distinct active set
  // once. Dependencies (such as MD022's blank-line maximum) are recalculated by
  // the converter rather than copied from the fully enabled configuration.
  const ids = [
    ...new Set(
      Object.values(compat.origins)
        .flat()
        .filter((id) => id.startsWith("MD")),
    ),
  ];
  for (const id of ids) suppressed(id, 0);
  const boundaries = [
    ...new Set([
      0,
      ...[...cache.values()].flatMap((ranges) =>
        ranges.flatMap(({ start, end }) => [start, end + 1]),
      ),
    ]),
  ]
    .filter((at) => at <= source.length)
    .sort((a, b) => a - b);
  const converted = new Map<string, typeof effectiveRules>();
  const regions = boundaries.map((start) => {
    const disabled = ids.filter((id) => suppressed(id, start));
    const key = disabled.join(" ");
    let rules = converted.get(key);
    if (!rules) {
      rules = disabled.length
        ? resolveConfig({
            config: {
              ...convertConfig({
                ...(compat.markdownlint
                  ? {
                      markdownlint: {
                        ...Object.fromEntries(
                          Object.entries(compat.markdownlint).filter(
                            ([id]) => !disabled.includes(id),
                          ),
                        ),
                        ...Object.fromEntries(disabled.map((id) => [id, false])),
                      },
                    }
                  : {}),
                ...(compat.prettier ? { prettier: compat.prettier } : {}),
              }).config,
              ...(options.config?.overrides ? { overrides: options.config.overrides } : {}),
            },
            ...(options.path ? { path: options.path } : {}),
            ...(options.plugins ? { plugins: options.plugins } : {}),
          }).rules
        : effectiveRules;
      converted.set(key, rules);
    }
    return { start, rules };
  });
  function regionAt(position: number) {
    let low = 0;
    let high = regions.length;
    while (low < high) {
      const mid = (low + high) >>> 1;
      if (regions[mid]!.start <= position) low = mid + 1;
      else high = mid;
    }
    return Math.max(0, low - 1);
  }
  function rulesAt(position: number) {
    return regions[regionAt(position)]!.rules;
  }
  const variants: Record<string, RuleSetting[]> = {};
  for (const rules of converted.values())
    for (const [rule, value] of Object.entries(rules)) {
      if (JSON.stringify(value) === JSON.stringify(effectiveRules[rule])) continue;
      const values = (variants[rule] ??= []);
      if (!values.some((v) => JSON.stringify(v) === JSON.stringify(value))) values.push(value);
    }
  const proposals = new Map<string, Set<string>>();
  const editKeys = new WeakMap<Edit, string>();
  const editPermissions = new Map<string, Map<string, boolean>>();
  const editKey = (finding: Finding) => {
    const edit = finding.edit!;
    let key = editKeys.get(edit);
    if (key === undefined) {
      key = JSON.stringify(edit);
      editKeys.set(edit, key);
    }
    return key;
  };
  const variantKey = (value: RuleSetting | undefined) => JSON.stringify(value);
  return Object.assign(
    (
      rule: string,
      finding: Finding,
      variant = effectiveRules[rule],
    ): CompatibleFinding | undefined => {
      if (JSON.stringify(rulesAt(finding.start)[rule]) !== JSON.stringify(variant))
        return undefined;
      // Missing provenance in compatibility mode must never bypass an ignore.
      const origins = compat.origins[rule] ?? (compat.prettier ? ["unknown prettier origin"] : []);
      const attribution = (finding as AttributedFinding)[sourceChecks];
      let checks = origins.filter((id) => id.startsWith("MD"));
      if (attribution) checks = checks.filter((id) => attribution.checks.includes(id));
      if (rule === "style/block-spacing") {
        const check = /the heading/.test(finding.message)
          ? "MD022"
          : /the fenced code block/.test(finding.message)
            ? "MD031"
            : /the list/.test(finding.message)
              ? "MD032"
              : /the table/.test(finding.message)
                ? "MD058"
                : undefined;
        checks = checks.filter((id) => id === check);
      } else if (rule === "structure/unspaced-heading") {
        const check = finding.message.includes("add spaces inside the hashes") ? "MD020" : "MD018";
        checks = checks.filter((id) => id === check);
      }
      const markdownlint = checks.some((id) => !suppressed(id, finding.start));
      const fromPrettier = origins.some((id) => !id.startsWith("MD"));
      const start = finding.edit?.start ?? finding.start;
      const end = finding.edit?.end ?? finding.end ?? start;
      const ignored = !!compat.prettier && intersects(prettier, start, end);
      if (!markdownlint && (!fromPrettier || ignored)) return undefined;
      const positional = finding.edit && intersects(positionalRanges, start, end);
      let editSuppressed = !fromPrettier && !checks.some((id) => !suppressed(id, start, end));
      if (finding.edit) {
        // Edits are indivisible. Every intersected region must propose the exact
        // replacement and authorize every source behavior combined in it.
        const required = attribution?.editChecks ?? attribution?.checks;
        const key = editKey(finding);
        const requirements = JSON.stringify(required ?? checks);
        const permissions = editPermissions.get(key) ?? new Map<string, boolean>();
        editPermissions.set(key, permissions);
        let permitted = permissions.get(requirements);
        if (permitted === undefined) {
          permitted = true;
          const last = regionAt(Math.max(start, end - 1));
          for (let i = regionAt(start); i <= last; i++) {
            const at = Math.max(start, regions[i]!.start);
            const regional = regions[i]!.rules[rule];
            const agrees = proposals.get(editKey(finding))?.has(variantKey(regional));
            const authorized =
              fromPrettier ||
              (required
                ? required.every((id) => origins.includes(id) && !suppressed(id, at))
                : checks.some((id) => !suppressed(id, at)));
            if (!agrees || !authorized) {
              permitted = false;
              break;
            }
          }
          permissions.set(requirements, permitted);
        }
        if (!permitted) editSuppressed = true;
      }
      if ((ignored || positional || editSuppressed) && finding.edit) {
        const retained = { ...finding };
        delete retained.edit;
        return retained;
      }
      return markdownlint ? finding : { ...finding, compatibilitySeverity: "warn" };
    },
    {
      variants,
      prepare: (rule: string, findings: (Finding & { variant?: RuleSetting })[]) => {
        proposals.clear();
        editPermissions.clear();
        for (const finding of findings) {
          if (!finding.edit) continue;
          const key = editKey(finding);
          const values = proposals.get(key) ?? new Set<string>();
          values.add(variantKey(finding.variant ?? effectiveRules[rule]));
          proposals.set(key, values);
        }
      },
    },
  );
}
