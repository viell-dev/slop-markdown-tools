import type { Root } from "mdast";
import type { Extension as SyntaxExtension } from "micromark-util-types";
import type { Extension as TreeExtension } from "mdast-util-from-markdown";
import type { AnySchema } from "ajv";

export type Dialect = "commonmark" | "github" | "forgejo" | "gitea" | "obsidian";
/** A dialect or one of its aliases, accepted wherever configuration names a dialect. */
export type DialectName = Dialect | "codeberg";
export type Severity = "off" | "warn" | "error";
export type RuleSetting = Severity | [Severity] | [Severity, Record<string, unknown>];
/** Replace `start` to `end`, half-open UTF-16 offsets into `document.source`, with `text`. */
export interface Edit {
  start: number;
  end: number;
  text: string;
}
/**
 * What a rule reports. Offsets are integers into `document.source`, from 0 to
 * its length, and `end` is not before `start`; a rule that returns anything
 * else is skipped for the document and reported as `engine/rule-error`.
 */
export interface Finding {
  message: string;
  start: number;
  end?: number;
  edit?: Edit;
}
export interface Diagnostic extends Finding {
  rule: string;
  severity: Exclude<Severity, "off">;
  line: number;
  column: number;
}
export interface Document {
  source: string;
  path: string;
  tree: Root;
  dialect: Dialect;
}
export interface LinkResolution {
  /**
   * `unreadable` means that the target could not be checked, because the
   * workspace could not read what it would have to; it is neither found nor
   * known to be missing.
   */
  status:
    "resolved" | "missing" | "ambiguous" | "external" | "unavailable" | "directory" | "unreadable";
  target?: string;
  fragment?: string;
  fragmentExists?: boolean;
  /**
   * What could not be read and limits the result. With status `unreadable` it
   * is the target file itself, when `target` is set and its content was needed
   * to check the fragment, or else the directories that may hold the target.
   * With status `resolved` the target was found among the readable files, by an
   * Obsidian name search or in a place that Obsidian tries after one of these
   * directories. They may hold another match, or the one Obsidian would choose,
   * so the link must not be rewritten. An entry that starts with `..` stands
   * for the part of an Obsidian vault that lies outside the workspace root.
   */
  unreadable?: string[];
  /**
   * With status `resolved` in the Obsidian dialect: the target's path as
   * Obsidian counts it, from the folder of the linking note's vault, when that
   * folder is not the workspace root and the path so differs from `target`.
   */
  rooted?: string;
  /**
   * The folder of the linking note's vault, relative to the workspace root, when
   * an Obsidian link was resolved inside a vault that lies below the root. A
   * path that Obsidian counts from the vault starts there, not at the root.
   */
  vault?: string;
  /**
   * With status `missing`: an existing file or folder that the link's path names
   * outside the linking note's vault, where Obsidian does not look.
   */
  outside?: string;
}
export interface Workspace {
  resolve(source: string, destination: string, dialect: Dialect, wiki?: boolean): LinkResolution;
  /** Obsidian's strictLineBreaks setting; false prevents semantic-changing prose reflow. */
  strictLineBreaks?: boolean;
}
export interface RuleContext {
  document: Document;
  options: Record<string, unknown>;
  workspace?: Workspace;
}
/**
 * A rule. `ruleRegistry`, and so `lint` and `format`, reject a plugin rule
 * that does not have this shape, naming it.
 */
export interface Rule {
  description: string;
  kind: "style" | "problem";
  /** Inline edits, then block layout, then document-wide whitespace. */
  phase?: "inline" | "block" | "document";
  /** Validates the rule's options; compiled once and reused for every document. */
  schema?: AnySchema;
  /**
   * The rule's findings for one document. A rule that throws is skipped for
   * that document and reported as `engine/rule-error`.
   */
  check(context: RuleContext): Finding[];
}
export interface Plugin {
  name: string;
  rules?: Record<string, Rule>;
  presets?: Record<string, Config>;
  syntax?: { micromark: SyntaxExtension; mdast: TreeExtension };
}
export interface Override {
  files: string[];
  dialect?: DialectName;
  rules?: Record<string, RuleSetting>;
}
export interface ResolveOptions {
  gitIgnored?: boolean;
  nestedRepositories?: boolean;
}
export interface Config {
  resolve?: ResolveOptions;
  extends?: string | string[];
  /**
   * The dialect documents are read in. When neither this setting, a preset, nor
   * a matching override names one, the caller's default dialect is assumed, and
   * `github` when the caller gives none.
   */
  dialect?: DialectName;
  rules?: Record<string, RuleSetting>;
  ignore?: string[];
  overrides?: Override[];
  plugins?: string[];
}
export interface ResolvedConfig {
  resolve: ResolveOptions;
  dialect: Dialect;
  rules: Record<string, RuleSetting>;
  ignore: string[];
}
export interface ProcessOptions {
  path?: string;
  config?: Config;
  plugins?: Plugin[];
  workspace?: Workspace;
  /**
   * The dialect to assume when the configuration names none for the document;
   * `github` when omitted. A dialect named by the configuration, a preset, or a
   * matching override takes precedence. The CLI passes `obsidian` for a
   * document inside an Obsidian vault, wherever the vault lies in the workspace.
   */
  defaultDialect?: DialectName;
  /**
   * Parts of the source to lint or format, as half-open UTF-16 offsets into
   * the text as given. Each range is widened to the complete blocks that it
   * touches, such as paragraphs, headings, tables, and code blocks, also inside
   * lists and block quotes, with their whole lines and the line breaks next to
   * them, where blank lines between blocks are edited. `lint` then returns the
   * diagnostics that start in those parts, and `format` applies only edits
   * that lie wholly in them, so that the rest of the text stays as it is. The
   * whole document is still parsed and checked. Omitted, the whole document is
   * processed; an empty list processes nothing.
   */
  ranges?: SourceRange[];
}
/** A part of a text, as half-open UTF-16 offsets. */
export interface SourceRange {
  start: number;
  end: number;
}
export interface FormatResult {
  /**
   * The formatted text. It leaves out the edits of each rule that would change
   * the document's meaning, reported as `engine/unsafe-format` where the
   * meaning would first differ, and is the text as given when formatting did
   * not settle.
   */
  output: string;
  changed: boolean;
  diagnostics: Diagnostic[];
  /**
   * With `ranges`: the parts of the output that formatting was limited to,
   * each range widened to its blocks and moved by the edits applied in it.
   */
  scope?: SourceRange[];
}
