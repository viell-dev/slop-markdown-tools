// `mdrefine/node`: what needs the filesystem, kept apart from the main entry,
// which never touches it.
export { discoverWorkspace } from "./workspace/discovery.js";
export type { DiscoverOptions, WorkspaceDiscovery } from "./workspace/discovery.js";
export type { Skipped } from "./workspace/files.js";
