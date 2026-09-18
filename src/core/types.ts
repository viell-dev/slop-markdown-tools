import type { Root } from "mdast";
import type { Extension as SyntaxExtension } from "micromark-util-types";
import type { Extension as TreeExtension } from "mdast-util-from-markdown";
import type { AnySchema } from "ajv";

export type Dialect = "commonmark" | "github" | "obsidian";
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
  status: "resolved" | "missing" | "ambiguous" | "external" | "unavailable" | "directory";
  target?: string;
  fragment?: string;
  fragmentExists?: boolean;
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
  dialect?: Dialect;
  rules?: Record<string, RuleSetting>;
}
export interface ResolveOptions {
  gitIgnored?: boolean;
  nestedRepositories?: boolean;
}
export interface Config {
  resolve?: ResolveOptions;
  extends?: string[];
  dialect?: Dialect;
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
