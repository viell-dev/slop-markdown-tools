// `mdrefine/node`: what needs the filesystem, kept apart from the main entry,
// which never touches it.
export { discoverWorkspace } from "./workspace/discovery.js";
export type { DiscoverOptions, WorkspaceDiscovery } from "./workspace/discovery.js";
export type { Skipped } from "./workspace/files.js";
export { auditReachability } from "./audit/reachability.js";
export type {
  ReachabilityOptions,
  ReachabilityProblem,
  ReachabilityReport,
} from "./audit/reachability.js";
export { formatWithCode } from "./code/format.js";
export type { CodeFormatOptions } from "./code/format.js";

export { loadConfig } from "./config/load.js";
export type { LoadedConfig } from "./config/load.js";
export { loadCompetitorConfig, competitorFiles } from "./config/competitors.js";
