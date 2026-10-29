export {
  lint,
  format,
  applyEdits,
  semanticFingerprint,
  builtInRules,
  ruleRegistry,
} from "./core/engine.js";
export {
  resolveConfig,
  validateConfig,
  configSchema,
  presets,
  dialects,
  dialectAliases,
  canonicalDialect,
} from "./config/resolve.js";
export { parse, range, textContent } from "./syntax/parse.js";
export { createWorkspace } from "./workspace/index.js";
export { unifiedDiff } from "./cli/diff.js";
export type { LookupResult, WorkspaceOptions, WorkspaceSource } from "./workspace/index.js";
export type * from "./core/types.js";
export type { ObsidianComment, ObsidianHighlight, WikiLink } from "./syntax/obsidian.js";

export { convertConfig, competitorMappings } from "./config/convert.js";
export type { ConversionReport, CompetitorMapping } from "./config/convert.js";
