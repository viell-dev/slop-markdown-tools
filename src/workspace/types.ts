import type { Dialect } from "../core/types.js";

/**
 * A Markdown file's text, null for a file that is not Markdown, or a loader
 * that returns the text when a fragment check needs it. Only a file that
 * `isMarkdownName` accepts for the link's dialect is read for anchors. A
 * loader that throws an error whose `code` is `EACCES`, `EPERM`, or `EBUSY`,
 * or `ERR_ENCODING_INVALID_ENCODED_DATA` for a file that is not UTF-8 text,
 * marks the file as unreadable; any other error propagates.
 */
export type WorkspaceSource = string | null | (() => string);

/** What `WorkspaceOptions.lookup` found at a path. */
export type LookupResult =
  /** A file, with its path as found from the root and its source as in `files`. */
  | {
      type: "file";
      path: string;
      source: WorkspaceSource;
      /** Whether another file also matches, so this path is not a unique target. */
      ambiguous?: boolean;
    }
  | { type: "directory" }
  /**
   * Something whose real location lies outside the workspace root, reached
   * through the symbolic link or junction `through`, which the host does not
   * follow: the root bounds what is read.
   */
  | { type: "outside"; through: string }
  /** Something that the system does not let the host examine; `at` names it. */
  | { type: "unreadable"; at: string };

/** The options of `createWorkspace`. */
export interface WorkspaceOptions {
  /** The dialect that link targets are parsed in; `github` when omitted. */
  dialect?: Dialect;
  /**
   * `true` when the vault's "Strict line breaks" setting is verified on, which
   * the workspace then reports as `Workspace.strictLineBreaks`. Obsidian notes
   * are wrapped only then.
   */
  strictLineBreaks?: boolean;
  /** Existing directories, including empty ones; never treated as note targets. */
  directories?: string[];
  /**
   * Existing directories whose contents could not be read. A link that leads
   * into one, or that an Obsidian name search finds nowhere else, resolves as
   * `unreadable` instead of `missing`.
   */
  unreadable?: string[];
  /**
   * Looks for a path that `files` and `directories` do not hold, when a link
   * names it: a host that leaves some folders or links out of the index, such
   * as the CLI, finds there what a link names. It returns what is at the path,
   * or undefined when nothing is. `folded` asks for Obsidian's matching,
   * without regard to letter case. A search by note name does not use it.
   */
  lookup?: (path: string, folded: boolean) => LookupResult | undefined;
  /**
   * Folders below the workspace root that are Obsidian vaults of their own. An
   * Obsidian link in a note of such a vault reaches only the vault's files: a
   * path is counted from the vault's folder, and a search by name looks inside
   * it. Other dialects, and notes outside these folders, resolve as without it.
   */
  vaults?: string[];
  /**
   * The workspace root's own path inside an Obsidian vault, such as
   * `Projects/Notes`, when the root is a folder of that vault and not the vault
   * itself. The rest of the vault is then out of sight: an Obsidian link whose
   * target could lie there, or be outdone by a note there, resolves as
   * `unreadable` or as `resolved` with `unreadable` set, never as `missing`.
   */
  rootInVault?: string;
}
