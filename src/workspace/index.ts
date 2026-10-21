import type { Workspace } from "../core/types.js";
import type { WorkspaceSource, WorkspaceOptions } from "./types.js";
import { createTargetIndex } from "./targets.js";
import { resolveLink } from "./resolver.js";

export type { WorkspaceSource, LookupResult, WorkspaceOptions } from "./types.js";
export { isMarkdownName } from "./targets.js";
export { splitDestination } from "./resolver.js";

/**
 * The workspace of `files`, which maps each path, relative to the workspace
 * root with forward slashes, to a `WorkspaceSource`. Link checks, link
 * rewriting, and Obsidian wrapping need one. A Markdown target is parsed in
 * `options.dialect` when a link's fragment needs its anchors, which are kept
 * and its text is not.
 */

export function createWorkspace(
  files: Record<string, WorkspaceSource>,
  options: WorkspaceOptions = {},
): Workspace {
  const index = createTargetIndex(files, options);
  return {
    ...(options.strictLineBreaks === undefined
      ? {}
      : { strictLineBreaks: options.strictLineBreaks }),
    resolve(source, destination, dialect, wiki = false) {
      return resolveLink(index, source, destination, dialect, wiki);
    },
  };
}
