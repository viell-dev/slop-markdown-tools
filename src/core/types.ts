import type { Root } from "mdast";
import type { Extension as SyntaxExtension } from "micromark-util-types";
import type { Extension as TreeExtension } from "mdast-util-from-markdown";

/** A dialect: the renderer whose Markdown syntax a document is read in. */
export type Dialect = "commonmark" | "github" | "forgejo" | "gitea" | "obsidian" | "vitepress";
/** Syntax and routing choices of a VitePress 2 site, without executing its config. */
export interface VitePressOptions {
  readonly math?: boolean;
  readonly attrs?: boolean;
  readonly footnote?: boolean;
  readonly tasklist?: boolean;
  readonly cjkFriendlyEmphasis?: boolean;
  readonly customContainers?: readonly string[];
  /** Source directory relative to the workspace root; inferred from .vitepress when omitted. */
  readonly srcDir?: string;
  /** The default VitePress slugger, or a site configured with github-slugger. */
  readonly anchor?: "vitepress" | "github";
}
/**
 * A dialect or one of its aliases, accepted wherever a dialect is named:
 * `codeberg` is `forgejo`. Parsed documents and resolved configurations hold
 * the dialect itself.
 */
export type DialectName = Dialect | "codeberg";
/** How a rule's findings count: `off` disables the rule. */
export type Severity = "off" | "warn" | "error";
/**
 * A rule's setting in a configuration: its severity, or a list of its severity
 * and, optionally, its options, which the rule's `schema` checks.
 */
export type RuleSetting =
  Severity | readonly [Severity] | readonly [Severity, Readonly<Record<string, unknown>>];
/**
 * A JSON Schema of draft 7, the version that Ajv validates by default: `true`
 * accepts every value, `false` none, and an object holds keywords such as
 * `type` and `properties`.
 */
export type JsonSchema = boolean | JsonSchemaObject;
/** A JSON Schema written as an object of keywords. */
export interface JsonSchemaObject {
  readonly [keyword: string]: unknown;
}
/** A replacement of part of a text. */
export interface Edit {
  /** Where the replaced text starts: an offset in UTF-16 code units, from 0. */
  start: number;
  /** Where the replaced text ends, not included: an offset, not before `start`. */
  end: number;
  /** The text that replaces it. */
  text: string;
}
/**
 * What a rule reports. Offsets are integers into `document.source`, from 0 to
 * its length, and `end` is not before `start`; a rule that returns anything
 * else is skipped for the document and reported as `engine/rule-error`.
 */
export interface Finding {
  /** What is wrong, in a sentence. */
  message: string;
  /** Where the finding starts. */
  start: number;
  /** Where it ends, not included; omitted for a finding at one position. */
  end?: number;
  /** A style rule's correction, which `format` applies. Problem rules give none. */
  edit?: Edit;
}
/**
 * A finding as `lint` and `format` report it. Its offsets, and those of its
 * edit, count UTF-16 code units in the text given to them, byte order marks
 * included, so that the edit applies to that text.
 */
export interface Diagnostic extends Finding {
  /** The rule's ID, such as `style/wrap`, or `engine/…` for the engine's own diagnostics. */
  rule: string;
  /** The severity that the configuration gives the rule. */
  severity: Exclude<Severity, "off">;
  /** The line of `start`, counting from 1. */
  line: number;
  /** The column of `start` in UTF-16 code units, counting from 1. */
  column: number;
}
/**
 * A parsed document. `Document` is also the name of the browser's DOM type;
 * a module that uses both can import this one under another name.
 */
export interface Document {
  /** The text that was parsed, without the byte order marks it started with. */
  source: string;
  /** The document's path, relative to the workspace root with forward slashes. */
  path: string;
  /** The mdast syntax tree, whose positions are offsets into `source`. */
  tree: Root;
  /** The dialect it was read in, never an alias. */
  dialect: Dialect;
  /** Explicit renderer choices when the dialect is VitePress. */
  vitepress?: VitePressOptions;
}
/** Where a link leads, as `Workspace.resolve` finds it. */
export interface LinkResolution {
  /**
   * `resolved`: one file matches; `missing`: none does; `ambiguous`: several
   * match and nothing decides between them; `directory`: the destination names
   * a directory; `external`: a URL with a scheme, or one starting with `//`;
   * `unavailable`: the destination cannot be judged from files.
   * `unreadable` means that the target could not be checked, because the
   * workspace could not read what it would have to; it is neither found nor
   * known to be missing.
   */
  status:
    "resolved" | "missing" | "ambiguous" | "external" | "unavailable" | "directory" | "unreadable";
  /** The file found, as a path from the workspace root. */
  target?: string;
  /** The part of the destination after `#`, decoded, or an empty string. */
  fragment?: string;
  /**
   * With status `resolved`: whether the target has the heading, block, or
   * anchor that `fragment` names, by the rules of the dialect; `true` without
   * a fragment.
   */
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
   * With status `unreadable`: the symbolic link or junction inside the
   * workspace through which the link's path leads to a place outside the
   * workspace root, which bounds what the tool reads.
   */
  leavesRoot?: string;
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
/**
 * The files that links can reach, which `createWorkspace` builds. A host can
 * implement it itself.
 */
export interface Workspace {
  /**
   * Where a link leads. `source` is the linking document's path, `destination`
   * the destination as written, and `dialect` the linking document's dialect;
   * `wiki` is true for an Obsidian wikilink or embed. An error that it throws
   * stops `lint` and `format`.
   */
  resolve(source: string, destination: string, dialect: Dialect, wiki?: boolean): LinkResolution;
  /**
   * Obsidian's "Strict line breaks" setting of the vault, which is a property
   * of the workspace: `true` when it is verified on. Obsidian notes are wrapped
   * only then, because otherwise a single line break shows as a line break.
   */
  strictLineBreaks?: boolean;
}
/** What a rule's `check` receives. */
export interface RuleContext {
  /** The parsed document, which the rule must not change. */
  document: Document;
  /** The rule's options from the configuration, checked against its `schema`; `{}` without. */
  options: Readonly<Record<string, unknown>>;
  /** The workspace that links resolve in, or undefined when the host gave none. */
  workspace?: Workspace;
}
/**
 * A rule. `ruleRegistry`, and so `lint` and `format`, reject a plugin rule
 * that does not have this shape, naming it.
 */
export interface Rule {
  /** What the rule checks, in a sentence. */
  description: string;
  /** `problem` only reports; `style` may propose edits, which `format` applies. */
  kind: "style" | "problem";
  /** Inline edits, then block layout, then document-wide whitespace. */
  phase?: "inline" | "block" | "document";
  /** Validates the rule's options; compiled once and reused for every document. */
  schema?: JsonSchema;
  /**
   * The rule's findings for one document. A rule that throws is skipped for
   * that document and reported as `engine/rule-error`.
   */
  check(context: RuleContext): Finding[];
}
/** A plugin: rules, presets, and syntax, named with its `name` as a prefix. */
export interface Plugin {
  /**
   * The prefix of its rules and presets: a lowercase identifier of letters,
   * digits, and hyphens that starts with a letter, unique among the plugins of
   * a run. `engine` is reserved for the engine's own diagnostics.
   */
  name: string;
  /** Rules by name; rule `x` of plugin `p` has the ID `p/x`. */
  rules?: Record<string, Rule>;
  /** Presets by name; preset `x` of plugin `p` is extended as `p/x`. */
  presets?: Record<string, Config>;
  /** A micromark syntax extension and the mdast extension that builds its nodes. */
  syntax?: { micromark: SyntaxExtension; mdast: TreeExtension };
}
/** Settings for the documents that match one of `files`. */
export interface Override {
  readonly vitepress?: VitePressOptions;
  /** Glob patterns, matched against paths relative to the workspace root, with forward slashes. */
  readonly files: readonly string[];
  /** The dialect of the matching documents. */
  readonly dialect?: DialectName;
  /** Rule settings for the matching documents, applied after the configuration's own. */
  readonly rules?: Readonly<Record<string, RuleSetting>>;
  /** Replace configured code tools for these documents; false disables them. */
  readonly codeFormatters?: readonly CodeFormatter[] | false;
}
/** A trusted external command that formats the contents of selected code fences. */
export interface CodeFormatter {
  /** A unique, lowercase name used in operational diagnostics. */
  readonly id: string;
  /** Exact, case-sensitive fence languages, or ["*"] as the single fallback. */
  readonly languages: readonly string[];
  /** Executable name or path. It is never taken from Markdown or passed as a shell string. */
  readonly command: string;
  /** Arguments; {filepath} is replaced with the absolute document filename. */
  readonly args: readonly string[];
  /** Case-sensitive document globs to skip, relative to the workspace root. */
  readonly exclude?: readonly string[];
  /** Invocation deadline in milliseconds; 10,000 when omitted. */
  readonly timeoutMs?: number;
  /** Maximum stdout bytes per invocation; 1 MiB when omitted. */
  readonly maxOutputBytes?: number;
}
/** Files that links may lead to without being linted or formatted. */
export interface ResolveOptions {
  /** Files that `.gitignore` files exclude are link targets. Default: false. */
  gitIgnored?: boolean;
  /** Files of nested Git repositories are link targets. Default: false. */
  nestedRepositories?: boolean;
}
/**
 * A configuration, as a configuration file holds it. `configSchema` describes
 * it, and `validateConfig` checks it.
 */
export interface Config {
  /** VitePress 2 syntax and routing options; ignored by other dialects. */
  vitepress?: VitePressOptions;
  /** The JSON Schema for editors; the tool ignores it. */
  $schema?: string;
  /** Files that links may lead to; see `ResolveOptions`. */
  resolve?: Readonly<ResolveOptions>;
  /**
   * Presets to start from, in order: a preset name or a list of them. Without
   * it, the configuration starts from `recommended`.
   */
  extends?: string | readonly string[];
  /**
   * The dialect documents are read in. When neither this setting, a preset, nor
   * a matching override names one, the caller's default dialect is assumed, and
   * `github` when the caller gives none.
   */
  dialect?: DialectName;
  /** Rule settings by rule ID, applied after those of the presets. */
  rules?: Readonly<Record<string, RuleSetting>>;
  /** Glob patterns of documents that are never linted or formatted; they stay link targets. */
  ignore?: readonly string[];
  /** Settings for some documents, applied in order after the others. */
  overrides?: readonly Override[];
  /**
   * Plugins to load, as files or package names. Only a configuration file
   * loads them; the library takes plugin objects through its `plugins` option.
   */
  plugins?: readonly string[];
  /** Trusted, opt-in code tools; only the CLI and mdrefine/node execute them. */
  codeFormatters?: readonly CodeFormatter[] | false;
}
/** The settings in effect for one document, which `resolveConfig` returns. */
export interface ResolvedConfig {
  /** VitePress choices after preset and override merging. */
  vitepress: VitePressOptions;
  /** The `resolve` settings of the configuration and its presets. */
  resolve: ResolveOptions;
  /** Code tools after preset and override replacement; empty when disabled. */
  codeFormatters: CodeFormatter[];
  /** The dialect the document is read in, never an alias. */
  dialect: Dialect;
  /** The setting of every rule that the configuration, its presets, or an override names. */
  rules: Record<string, RuleSetting>;
  /** The `ignore` patterns of the configuration and its presets. */
  ignore: string[];
}
/** What decides the configuration in effect for a document; see `resolveConfig`. */
export interface ResolveConfigOptions {
  /**
   * The document's path, relative to the workspace root with forward slashes.
   * It selects overrides and resolves links; `document.md` when omitted.
   */
  path?: string | undefined;
  /** The configuration. Without it, the `recommended` preset applies. */
  config?: Config | undefined;
  /** Plugin objects, whose rules and presets the configuration can name. */
  plugins?: readonly Plugin[] | undefined;
  /**
   * The dialect to assume when the configuration names none for the document;
   * `github` when omitted. A dialect named by the configuration, a preset, or a
   * matching override takes precedence. The CLI passes `obsidian` for a
   * document inside an Obsidian vault, wherever the vault lies in the workspace.
   */
  defaultDialect?: DialectName | undefined;
}
/** The options of `lint` and `format`. */
export interface ProcessOptions extends ResolveConfigOptions {
  /** The files that links can reach. Without it, links are not checked or rewritten. */
  workspace?: Workspace | undefined;
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
  ranges?: readonly SourceRange[] | undefined;
}
/** A part of a text, as half-open UTF-16 offsets. */
export interface SourceRange {
  /** Where the part starts. */
  start: number;
  /** Where it ends, not included. */
  end: number;
}
/** What `format` returns. */
export interface FormatResult {
  /**
   * The formatted text. It leaves out the edits of each rule that would change
   * the document's meaning, reported as `engine/unsafe-format` where the
   * meaning would first differ, and is the text as given when formatting did
   * not settle.
   */
  output: string;
  /** Whether `output` differs from the text as given. */
  changed: boolean;
  /** The findings that remain in `output`, and the engine's own diagnostics. */
  diagnostics: Diagnostic[];
  /**
   * With `ranges`: the parts of the output that formatting was limited to,
   * each range widened to its blocks and moved by the edits applied in it.
   */
  scope?: SourceRange[];
}
