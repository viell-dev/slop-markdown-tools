import type { Finding } from "./types.js";

/** Internal source-check attribution; never a configuration option. */
export const compatibilityCheck = Symbol("compatibility check");
export const sourceChecks = Symbol("source checks");
export interface Attribution {
  checks: string[];
  editChecks?: string[];
  parts?: Finding[];
}
export type AttributedFinding = Finding & { [sourceChecks]?: Attribution };
export function attributed(
  finding: Finding,
  checks: string[],
  parts?: Finding[],
  editChecks?: string[],
): Finding {
  return Object.assign(finding, {
    [sourceChecks]: { checks, ...(parts ? { parts } : {}), ...(editChecks ? { editChecks } : {}) },
  });
}
export function compatibilityParts(finding: Finding): Finding[] {
  const info = (finding as AttributedFinding)[sourceChecks];
  return (
    info?.parts?.map((part) =>
      Object.assign(
        { ...part, ...(finding.edit ? { edit: finding.edit } : {}) },
        {
          [sourceChecks]: {
            ...(part as AttributedFinding)[sourceChecks]!,
            editChecks: info.editChecks ?? info.checks,
          },
        },
      ),
    ) ?? [finding]
  );
}
