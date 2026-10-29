import type { Finding } from "./types.js";

/**
 * Internal source-check attribution for competitor compatibility; never a
 * configuration option, and invisible outside a compatibility run. Rules read
 * their own attribution back through `attributionOf`; only during a
 * compatibility run does a finding also carry it as a symbol key, so that the
 * engine's internal copies keep it until it strips the key from diagnostics.
 */
export const sourceChecks = Symbol("source checks");
export interface Attribution {
  checks: string[];
  editChecks?: string[];
  parts?: Finding[];
}
export type AttributedFinding = Finding & { [sourceChecks]?: Attribution };
const recorded = new WeakMap<Finding, Attribution>();
let compatibilityDepth = 0;
/** Run a rule check as part of competitor compatibility. Rule checks are synchronous. */
export function inCompatibility<T>(run: () => T): T {
  compatibilityDepth++;
  try {
    return run();
  } finally {
    compatibilityDepth--;
  }
}
/** Whether the rule check that is running belongs to competitor compatibility. */
export function compatibilityRun(): boolean {
  return compatibilityDepth > 0;
}
export function attributionOf(finding: Finding): Attribution | undefined {
  return (finding as AttributedFinding)[sourceChecks] ?? recorded.get(finding);
}
export function attributed(
  finding: Finding,
  checks: string[],
  parts?: Finding[],
  editChecks?: string[],
): Finding {
  const info: Attribution = {
    checks,
    ...(parts ? { parts } : {}),
    ...(editChecks ? { editChecks } : {}),
  };
  recorded.set(finding, info);
  return compatibilityDepth > 0 ? Object.assign(finding, { [sourceChecks]: info }) : finding;
}
export function compatibilityParts(finding: Finding): Finding[] {
  const info = attributionOf(finding);
  return (
    info?.parts?.map((part) =>
      Object.assign(
        { ...part, ...(finding.edit ? { edit: finding.edit } : {}) },
        {
          [sourceChecks]: {
            ...attributionOf(part)!,
            editChecks: info.editChecks ?? info.checks,
          },
        },
      ),
    ) ?? [finding]
  );
}
