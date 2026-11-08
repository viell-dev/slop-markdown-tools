import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import type { Config, Plugin } from "../core/types.js";
import { resolveConfig } from "../config/resolve.js";
import { parse } from "../syntax/parse.js";
import { exists, systemErrorText } from "../workspace/access.js";
import { discoverContext } from "../workspace/discovery.js";
import { decodeText } from "../workspace/encoding.js";
import { isMarkdownName } from "../workspace/index.js";
import { navigation } from "./navigation.js";
import { reachableFrom } from "./graph.js";

/** An explicit, read-only audit of a whole workspace's Markdown navigation. */
export interface ReachabilityOptions {
  /** Directory whose eligible Markdown documents are audited; resolved to its real path. */
  root: string;
  /** Entry documents, relative to root, with forward slashes. At least one is required. */
  entries: readonly string[];
  /** Already loaded configuration; this API does not search for configuration files. */
  config?: Config;
  /** Plugin objects; rule-only plugins are supported, syntax plugins make coverage incomplete. */
  plugins?: Plugin[];
  /** Root-relative exact paths excluded from findings, but still usable as transit documents. */
  exclude?: string[];
}
/** Why the audit cannot establish that its graph is complete. */
export interface ReachabilityProblem {
  /** Root-relative document or directory whose navigation or contents could not be established. */
  path: string;
  /** Stable category of the coverage problem. */
  code: "discovery" | "unreadable" | "boundary" | "unresolved-link" | "unsupported-navigation";
  /** Human-readable explanation, including the reason or boundary when known. */
  message: string;
  /** The unresolved navigation destination as written in its source, when applicable. */
  destination?: string;
  /** Source line, counting from 1, when the problem comes from a source construct. */
  line?: number;
  /** UTF-16 source column, counting from 1, when a source location is available. */
  column?: number;
}
/** Paths are root-relative, sorted in UTF-16 code-unit order. No document is written. */
export interface ReachabilityReport {
  /** Absolute real path of the workspace root. */
  root: string;
  /** Explicit entry documents, deduplicated and sorted. */
  entries: string[];
  /** Eligible documents, after ignore rules and reporting exclusions. */
  documents: string[];
  /** Documents whose source was read and parsed, including excluded transit documents. */
  scanned: string[];
  /** Eligible documents reached through known edges; not proof of completeness. */
  reachable: string[];
  /** Always empty when complete is false. */
  unreachable: string[];
  /** True only when there are no coverage problems for the modeled source graph. */
  complete: boolean;
  /** Coverage problems, ordered by path, location, code and message. */
  problems: ReachabilityProblem[];
}

/** Reject traversal through links and repository boundaries before loading a source. */
async function boundary(root: string, name: string): Promise<string | undefined> {
  const parts = name.split("/");
  for (let index = 1; index <= parts.length; index++) {
    const relative = parts.slice(0, index).join("/");
    const full = path.join(root, relative);
    const info = await lstat(full);
    if (info.isSymbolicLink()) return `Traversal stops at symbolic link or junction: ${relative}.`;
    if (info.isDirectory() && (await exists(path.join(full, ".git"))))
      return `Traversal stops at nested repository: ${relative}.`;
    if (index === parts.length && !info.isFile()) return `Not an ordinary file: ${relative}.`;
  }
  return undefined;
}

/**
 * Audit the complete workspace, reusing the CLI's discovery and dialect resolution.
 * Invalid entries/configuration throw. Incomplete reads/navigation return explicit problems
 * and suppress unreachable findings. The main portable entry and rule contracts are unchanged.
 */
export async function auditReachability(options: ReachabilityOptions): Promise<ReachabilityReport> {
  if (!options.entries.length) throw new Error("Reachability audit requires at least one entry.");
  const entries = [
    ...new Set(
      options.entries.map((entry) => {
        const name = path.posix.normalize(entry.replaceAll("\\", "/"));
        if (
          path.isAbsolute(entry) ||
          /^(?:[A-Za-z]:|\/)/.test(name) ||
          name === ".." ||
          name.startsWith("../")
        )
          throw new Error(`Entry is outside the workspace: ${entry}`);
        return name;
      }),
    ),
  ].sort();
  const context = await discoverContext(
    {
      root: options.root,
      ...(options.config ? { config: options.config } : {}),
      ...(options.plugins ? { plugins: options.plugins } : {}),
      ...(options.exclude ? { exclude: options.exclude } : {}),
    },
    path.resolve(options.root),
  );
  const { discovery, set } = context;
  const documents = discovery.selected.filter((name) =>
    isMarkdownName(name, resolveConfig(discovery.options(name)).dialect),
  );
  const candidates = new Set(documents);
  for (const entry of entries)
    if (!candidates.has(entry))
      throw new Error(
        `Entry is not an eligible workspace Markdown document (missing, ignored, or excluded): ${entry}`,
      );
  const problems: ReachabilityProblem[] = [];
  const graph = new Map<string, string[]>();
  const scheduled = new Set(documents);
  const queue = [...documents];
  const scanned: string[] = [];
  if (options.plugins?.some((plugin) => plugin.syntax))
    problems.push({
      path: ".",
      code: "unsupported-navigation",
      message: "Syntax plugins can add navigation that this audit does not model.",
    });
  for (let index = 0; index < queue.length; index++) {
    const name = queue[index]!;
    let source: string;
    try {
      const stopped = await boundary(set.root, name);
      if (stopped) {
        problems.push({ path: name, code: "boundary", message: stopped });
        continue;
      }
      // The ordinary selection reader intentionally refuses ignored transit documents.
      // Read only an exact, boundary-checked path; discovery still controls eligibility.
      source = decodeText(await readFile(path.join(set.root, name)), name);
    } catch (error) {
      const reason = systemErrorText(error);
      if (!reason) throw error;
      problems.push({
        path: name,
        code: "unreadable",
        message: `Document could not be read: ${reason}.`,
      });
      continue;
    }
    const processOptions = await context.targetOptions(name);
    const { dialect, vitepress } = resolveConfig(processOptions);
    const document = parse(source, dialect, name, options.plugins, vitepress);
    scanned.push(name);
    const { links, limits } = navigation(document);
    for (const limit of limits)
      problems.push({ path: name, code: "unsupported-navigation", ...limit });
    const targets = new Set<string>();
    for (const link of links) {
      // Document reachability does not depend on fragment validity. Avoid reading target
      // anchors (or VitePress includes) merely to determine which document a link names.
      const destination = link.destination.split("#", 1)[0]!;
      const result = processOptions.workspace!.resolve(name, destination, dialect, link.wiki);
      if (result.status === "external") continue;
      if (
        result.status !== "resolved" ||
        result.unreadable?.length ||
        result.target === undefined
      ) {
        problems.push({
          path: name,
          code: "unresolved-link",
          destination: link.destination,
          line: link.line,
          column: link.column,
          message: `Local navigation could not be established (${result.status}${result.unreadable?.length ? "; incomplete lookup" : ""}): ${link.destination}.`,
        });
        continue;
      }
      if (!isMarkdownName(result.target, dialect)) continue;
      targets.add(result.target);
      if (!scheduled.has(result.target)) {
        scheduled.add(result.target);
        queue.push(result.target);
      }
    }
    graph.set(name, [...targets]);
  }
  for (const item of set.skipped)
    if (item.code !== "IGNORED")
      problems.push({ path: item.path, code: "discovery", message: item.message });
  const reached = reachableFrom(entries, graph);
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  problems.sort(
    (a, b) =>
      compare(a.path, b.path) ||
      (a.line ?? 0) - (b.line ?? 0) ||
      (a.column ?? 0) - (b.column ?? 0) ||
      compare(a.code, b.code) ||
      compare(a.message, b.message),
  );
  return {
    root: set.root,
    entries,
    documents,
    scanned: scanned.sort(),
    reachable: documents.filter((name) => reached.has(name)),
    unreachable: problems.length ? [] : documents.filter((name) => !reached.has(name)),
    complete: problems.length === 0,
    problems,
  };
}
