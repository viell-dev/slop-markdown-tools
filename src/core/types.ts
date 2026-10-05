import type { Root } from "mdast";
import type { Extension as SyntaxExtension } from "micromark-util-types";
import type { Extension as TreeExtension } from "mdast-util-from-markdown";
import type { AnySchema } from "ajv";

export type Dialect = "commonmark" | "github" | "forgejo" | "gitea" | "obsidian";
/** A dialect or one of its aliases, accepted wherever configuration names a dialect. */
export type DialectName = Dialect | "codeberg";
export type Severity = "off" | "warn" | "error";
export type RuleSetting = Severity | [Severity, Record<string, unknown>];
export interface Edit {
  start: number;
  end: number;
  text: string;
}
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
   * With status `resolved` the target was found by an Obsidian name search
   * among the readable files, and one of these directories may hold another
   * match, so the link must not be rewritten.
   */
  unreadable?: string[];
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
export interface Rule {
  description: string;
  kind: "style" | "problem";
  /** Inline edits, then block layout, then document-wide whitespace. */
  phase?: "inline" | "block" | "document";
  schema?: AnySchema;
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
  extends?: string[];
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
}
export interface FormatResult {
  output: string;
  changed: boolean;
  diagnostics: Diagnostic[];
}
