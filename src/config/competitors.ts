import { GLOBSTAR, Minimatch } from "minimatch";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import gitignore from "ignore";
import { parse as json, type ParseError } from "jsonc-parser";
import { parse as yaml } from "yaml";
import { exists } from "../workspace/access.js";
import { convertConfig, type ConversionReport } from "./convert.js";
import type { Config, Override } from "../core/types.js";

type Values = Record<string, unknown>;
const object = (value: unknown, where: string): Values => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`Expected a configuration object in ${where}`);
  return value as Values;
};
/** The text of an error, for a message that adds where it happened. */
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Paths that stand for `.md` files at the root and in nested directories. */
const markdownProbes = ["", "mdrefine-probe/", "mdrefine-probe/nested/"].map(
  (directory) => `${directory}mdrefine-probe.md`,
);
/**
 * Whether a `.prettierignore` leaves Markdown to another tool. Prettier reads
 * it with the `ignore` package, as gitignore rules without regard to letter
 * case, so it is evaluated that way against `.md` paths at several depths and
 * against the paths that its negated entries name, `.markdown` ones included.
 * `.markdown` files are not required to be ignored as well: an entry for `.md`
 * files alone is the usual way to leave Markdown to another tool, and taking it
 * for Prettier's Markdown setup would ignore every document. A negated entry
 * whose path cannot be derived, such as one with a character class, could
 * re-include a document, so the answer is then no.
 */
export function ignoresAllMarkdown(text: string): boolean {
  const matcher = gitignore({ allowRelativePaths: true }).add(text);
  const probes = [...markdownProbes];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("!")) continue;
    const named = line.slice(1).trim().replace(/^\//, "").replace(/\/$/, "");
    if (!named || /[[\]\\]/.test(named)) return false;
    const sample = named
      .replace(/\*\*/g, "mdrefine-probe")
      .replace(/\*/g, "mdrefine-probe")
      .replace(/\?/g, "x");
    if (/\.(?:md|markdown)$/i.test(sample)) probes.push(sample);
    else probes.push(`${sample}.md`, `${sample}/mdrefine-probe.md`);
  }
  return probes.every((probe) => matcher.ignores(probe));
}
/** Recognized competitor configuration filenames, in search precedence order. */
export const competitorFiles = {
  markdownlint: [
    ".markdownlint.jsonc",
    ".markdownlint.json",
    ".markdownlint.yaml",
    ".markdownlint.yml",
    ".markdownlint-cli2.jsonc",
    ".markdownlint-cli2.json",
    ".markdownlint-cli2.yaml",
    ".markdownlint-cli2.yml",
    ".markdownlint.cjs",
    ".markdownlint.mjs",
    ".markdownlint.js",
    ".markdownlint-cli2.cjs",
    ".markdownlint-cli2.mjs",
    ".markdownlint-cli2.js",
  ],
  prettier: [
    ".prettierrc",
    ".prettierrc.json",
    ".prettierrc.yml",
    ".prettierrc.yaml",
    ".prettierrc.json5",
    ".prettierrc.js",
    "prettier.config.js",
    ".prettierrc.ts",
    "prettier.config.ts",
    ".prettierrc.mjs",
    "prettier.config.mjs",
    ".prettierrc.mts",
    "prettier.config.mts",
    ".prettierrc.cjs",
    "prettier.config.cjs",
    ".prettierrc.cts",
    "prettier.config.cts",
    ".prettierrc.toml",
    ".prettierrc.jsonc",
  ],
} as const;

/** Reject globs whose final path component can only name another language. */
function markdownPattern(pattern: string): boolean {
  const matcher = new Minimatch(pattern);
  return matcher.set.some((parts) => {
    const last = parts.at(-1);
    if (typeof last === "string") return /\.(md|markdown)$/i.test(last);
    if (last instanceof RegExp) {
      // A literal extension remains decidable even when the basename is a glob.
      const extension = /\.([a-zA-Z0-9]+)$/.exec((last as RegExp & { _glob: string })._glob);
      return !extension || /^(md|markdown)$/i.test(extension[1]!);
    }
    return true;
  });
}
/** Preserve glob metacharacters that Minimatch parsed as literal filename characters. */
function literalPattern(value: string): string {
  return value.replace(/[#?*[\]{}()!+@\\]/g, "\\$&");
}

type PatternDialect = "prettier" | "editorconfig" | "cli2" | "gitignore";

/** Admit only syntax whose source meaning we can preserve in Minimatch. */
function translatePattern(pattern: string, dialect: PatternDialect): string | undefined {
  if (!pattern || /[\r\n\0]/.test(pattern) || pattern.startsWith("!")) return undefined;
  if (/^[a-zA-Z]:[/\\]/.test(pattern) || pattern.startsWith("//")) return undefined;
  if ((dialect === "prettier" || dialect === "cli2") && pattern.startsWith("/")) return undefined;
  if (dialect !== "gitignore" && /["']/.test(pattern)) return undefined;
  // Escapes of glob punctuation are portable; other escapes and character
  // classes have dialect-dependent meanings and are deliberately excluded.
  const syntax = pattern.replace(/\\[\\#?!*[\]{}()+@]/g, "x");
  if (/[\\[\]]/.test(syntax)) return undefined;
  // Root anchors (gitignore, EditorConfig) and directory suffixes (gitignore)
  // are not components.
  let components = syntax;
  if (dialect === "gitignore" || dialect === "editorconfig")
    components = components.replace(/^\//, "");
  if (dialect === "gitignore") components = components.replace(/\/$/, "");
  if (
    components
      .split("/")
      .some(
        (part) =>
          part === "" || part === "." || part === ".." || (part.includes("**") && part !== "**"),
      )
  )
    return undefined;
  if (dialect === "gitignore") {
    if (/\s$/.test(pattern)) return undefined;
    return pattern.replace(/\\.|[{}()+@!#]/g, (part) => (part.length === 2 ? part : `\\${part}`));
  }
  if (/[()]/.test(syntax)) return undefined;
  // Only flat comma alternatives, never ranges, nesting, or empty branches.
  if (/\{[^{}]*\.\.[^{}]*\}/.test(syntax)) return undefined;
  const braces = syntax.replace(/\{[^{},]+(?:,[^{},]+)+\}/g, "x");
  if (/[{}]/.test(braces)) return undefined;
  return pattern.replace(/^#/, "\\#");
}

/** Intersect component globs exactly when one component contains the other. */
function intersectPatterns(left: string, right: string): string[] {
  const results: string[] = [];
  for (const a of new Minimatch(left, { dot: true }).set)
    for (const b of new Minimatch(right, { dot: true }).set) {
      const visit = (i: number, j: number): string[][] => {
        if (i === a.length && j === b.length) return [[]];
        const x = a[i],
          y = b[j];
        if (x === GLOBSTAR && y === GLOBSTAR)
          return visit(i + 1, j)
            .concat(visit(i, j + 1))
            .map((tail) => ["**", ...tail]);
        if (x === GLOBSTAR) {
          const tails = visit(i + 1, j);
          if (y !== undefined)
            tails.push(
              ...visit(i, j + 1).map((tail) => [
                y === GLOBSTAR ? "**" : typeof y === "string" ? literalPattern(y) : y._glob!,
                ...tail,
              ]),
            );
          return tails;
        }
        if (y === GLOBSTAR) {
          const tails = visit(i, j + 1);
          if (x !== undefined)
            tails.push(
              ...visit(i + 1, j).map((tail) => [
                typeof x === "string" ? literalPattern(x) : x._glob!,
                ...tail,
              ]),
            );
          return tails;
        }
        if (x === undefined || y === undefined) return [];
        let component: string;
        if (typeof x === "string") {
          if (typeof y === "string" ? x !== y : !y.test(x)) return [];
          component = literalPattern(x);
        } else if (typeof y === "string") {
          if (!x.test(y)) return [];
          component = literalPattern(y);
        } else if (x._glob === y._glob || y._glob === "*") component = x._glob!;
        else if (x._glob === "*") component = y._glob!;
        else throw new Error("Unrepresentable glob intersection");
        return visit(i + 1, j + 1).map((tail) => [component, ...tail]);
      };
      results.push(
        ...visit(0, 0).map((parts) =>
          parts.filter((part, i) => part !== "**" || parts[i - 1] !== "**").join("/"),
        ),
      );
    }
  return [...new Set(results.filter(Boolean))];
}

/** Derive Prettier options only after EditorConfig keys and removals accumulate. */
function editorOptions(raw: Values): Values {
  const state = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== "unset"));
  const number = (key: string) =>
    typeof state[key] === "string" && /^\d+$/.test(state[key]) && Number(state[key]) > 0
      ? Number(state[key])
      : undefined;
  const indent = number("indent_size");
  // EditorConfig infers tab_width only when the source key is absent. An
  // explicit unset blocks that inference, even though Prettier ignores its value.
  const tab = "tab_width" in raw ? number("tab_width") : indent;
  const useTabs =
    state.indent_style === "space"
      ? false
      : state.indent_style === "tab" || state.indent_size === "tab";
  return {
    ...("indent_style" in raw || "indent_size" in raw ? { useTabs } : {}),
    ...("indent_size" in raw || "tab_width" in raw || "indent_style" in raw
      ? { tabWidth: (!useTabs && state.indent_style === "space" ? indent : undefined) ?? tab ?? 2 }
      : {}),
    ...("max_line_length" in raw ? { printWidth: number("max_line_length") ?? 80 } : {}),
    ...("end_of_line" in raw ? { endOfLine: state.end_of_line ?? "lf" } : {}),
  };
}

/** Read competitors only in directories the mdrefine search already visited, nearest first. */
export async function loadCompetitorConfig(
  directories: readonly string[],
  executeScripts = false,
  destination = directories.at(-1)!,
): Promise<ConversionReport | undefined> {
  const sources: string[] = [];
  const omitted: string[] = [];
  /** Files found and not used, with the reason, in the order they were found. */
  const unused = new Map<string, string>();
  /** A file from the destination, the workspace root, with forward slashes, when it lies inside. */
  const shown = (file: string) => {
    const relative = path.relative(destination, file);
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative)
      ? relative.split(path.sep).join("/")
      : file;
  };
  const rebase = (
    pattern: string,
    file: string,
    dialect: PatternDialect = "cli2",
    expandPrettier = true,
  ): string[] => {
    const translated = translatePattern(pattern, dialect);
    if (translated === undefined) {
      omitted.push(
        `${shown(file)}: pattern ${pattern} not carried over: outside the supported ${dialect} subset.`,
      );
      return [];
    }
    if (dialect === "prettier" && expandPrettier) {
      const basename = !translated.includes("/");
      const variants = [basename ? `**/${translated}` : translated];
      if (translated.endsWith("/**")) variants.push(translated.slice(0, -3));
      // Micromatch also accepts the exact original pattern text, not the
      // spelling of a generated zero-component branch.
      if (/(?<!\\)\{/.test(translated)) variants.push(literalPattern(translated));
      return [...new Set(variants.flatMap((variant) => rebase(variant, file, dialect, false)))];
    }
    pattern = translated;
    if (dialect === "editorconfig" && !pattern.includes("/")) pattern = `**/${pattern}`;
    const source = path.dirname(file);
    const prefix = path.relative(destination, source).split(path.sep).join("/");
    const local = pattern.replace(/^\//, "");
    if (prefix !== ".." && !prefix.startsWith("../"))
      return [prefix ? `${prefix}/${local}` : local];
    const subtree = path.relative(source, destination).split(path.sep).join("/");
    if (subtree === ".." || subtree.startsWith("../")) {
      omitted.push(
        `${shown(file)}: pattern ${pattern} not carried over: unrelated source directory.`,
      );
      return [];
    }
    // Consume the destination's literal path in the glob's finite-state matcher.
    // A globstar can consume a component or leave it for the following component.
    const results: string[] = [];
    const matcher = new Minimatch(local, { dot: true });
    if (matcher.negate || matcher.comment) {
      omitted.push(
        `${shown(file)}: pattern ${pattern} not carried over: cannot express its subtree intersection.`,
      );
      return [];
    }
    for (const parts of matcher.set) {
      let states = new Set([0]);
      const closure = () => {
        for (const index of states) if (parts[index] === GLOBSTAR) states.add(index + 1);
      };
      closure();
      for (const segment of subtree.split("/")) {
        const next = new Set<number>();
        for (const index of states) {
          const part = parts[index];
          if (part === GLOBSTAR) next.add(index);
          else if (typeof part === "string" ? part === segment : part?.test(segment))
            next.add(index + 1);
        }
        states = next;
        closure();
      }
      for (const index of states) {
        const rest = parts
          .slice(index)
          .map((part) =>
            part === GLOBSTAR ? "**" : typeof part === "string" ? literalPattern(part) : part._glob,
          )
          .join("/");
        if (rest) results.push(rest);
      }
    }
    return [...new Set(results)];
  };
  const unread = new Set<string>();
  const bypass = "; use --no-competitor-config to bypass conversion.";
  /** The module that a configuration names by package, as Node.js would require it from `file`. */
  const required = (name: string, file: string) => {
    try {
      return createRequire(file).resolve(name);
    } catch (error) {
      throw new Error(`Cannot resolve "${name}" named in ${shown(file)}${bypass}`, {
        cause: error,
      });
    }
  };
  const read = async (file: string, chain: string[] = []): Promise<Values> => {
    if (chain.includes(file))
      throw new Error(`Cyclic competitor extends: ${[...chain, file].map(shown).join(" -> ")}`);
    sources.push(file);
    let value: unknown;
    if (/\.[cm]?[jt]s$/.test(file)) {
      if (!executeScripts) {
        unread.add(file);
        unused.set(
          file,
          'the fallback does not run JavaScript or TypeScript; "mdrefine config convert" can convert it',
        );
        return {};
      }
      try {
        value = ((await import(pathToFileURL(file).href)) as { default: unknown }).default;
      } catch (error) {
        throw new Error(`Cannot load ${shown(file)}: ${reason(error)}`, { cause: error });
      }
    } else if (/\.(toml|json5)$/.test(file)) {
      unread.add(file);
      unused.set(
        file,
        `${file.endsWith(".toml") ? "TOML" : "JSON5"} is not supported; write these settings as JSON or YAML`,
      );
      return {};
    } else {
      const text = await readFile(file, "utf8");
      if (/\.jsonc?$/.test(file)) {
        const errors: ParseError[] = [];
        value = json(text, errors, { allowTrailingComma: true });
        if (errors.length) throw new Error(`Invalid competitor JSON in ${shown(file)}${bypass}`);
      } else {
        // Prettier reads an extensionless .prettierrc as YAML too, with the same
        // parser, so JSON reads as JSON there, and a JSON comment joins the key after it.
        try {
          value = text.trim() ? (yaml(text) as unknown) : {};
        } catch (error) {
          throw new Error(
            `Invalid competitor YAML in ${shown(file)}: ${reason(error).split("\n")[0]!.replace(/:$/, "")}${bypass}`,
            { cause: error },
          );
        }
      }
    }
    const result = object(value, shown(file));
    if (path.basename(file) === ".prettierrc")
      for (const key of Object.keys(result))
        if (/^\s*(?:\/\/|\/\*)/.test(key)) {
          omitted.push(
            `${shown(file)}: ${JSON.stringify(key)} is not a Prettier option: Prettier reads this file as YAML, where a JSON comment becomes part of the key after it, and ignores it; not carried over.`,
          );
          delete result[key];
        }
    const nested =
      file.includes("-cli2.") && result.config !== undefined
        ? object(result.config, `the config of ${shown(file)}`)
        : result;
    if (nested.extends !== undefined) {
      const names = Array.isArray(nested.extends) ? nested.extends : [nested.extends];
      let base: Values = {};
      for (const name of names) {
        if (typeof name !== "string") throw new Error(`Invalid extends in ${shown(file)}`);
        const resolved =
          (await exists(path.resolve(path.dirname(file), name))) || path.isAbsolute(name)
            ? path.resolve(path.dirname(file), name)
            : required(name, file);
        base = { ...base, ...(await read(resolved, [...chain, file])) };
      }
      delete nested.extends;
      const merged = { ...base, ...nested };
      return nested === result ? merged : { ...result, config: merged };
    }
    return result;
  };
  const find = async (names: readonly string[]) => {
    for (const directory of directories)
      for (const name of names) {
        const file = path.join(directory, name);
        if (await exists(file)) return file;
      }
    return undefined;
  };
  const markdownFile = await find(
    competitorFiles.markdownlint.filter((name) => !name.includes("-cli2.")),
  );
  const cli2File = await find(
    competitorFiles.markdownlint.filter((name) => name.includes("-cli2.")),
  );
  const prettierFile = await find(competitorFiles.prettier);
  let markdownlint = markdownFile ? await read(markdownFile) : undefined;
  let prettier: Values | undefined;
  let prettierSource: string | undefined;
  // The file that holds the Prettier options, which a package key can name.
  let prettierData: string | undefined;
  let prettierKey: unknown;
  for (const directory of directories) {
    for (const name of ["package.json", "package.yaml"]) {
      const file = path.join(directory, name);
      if (!(await exists(file))) continue;
      let pkg: Values;
      try {
        const text = await readFile(file, "utf8");
        pkg = object(
          name.endsWith("json") ? (JSON.parse(text) as unknown) : (yaml(text) as unknown),
          name,
        );
      } catch {
        continue;
      }
      if (pkg.prettier === undefined) continue;
      prettierSource = file;
      prettierKey = pkg.prettier;
      break;
    }
    if (prettierSource) break;
    if (prettierFile && path.dirname(prettierFile) === directory) {
      prettierSource = prettierData = prettierFile;
      break;
    }
  }
  const ignoreFile = await find([".prettierignore"]);
  const ignoreText = ignoreFile ? await readFile(ignoreFile, "utf8") : undefined;
  if (prettierSource && ignoreText !== undefined && ignoresAllMarkdown(ignoreText))
    // Prettier leaves Markdown to another tool here, so its settings are not this workspace's
    // Markdown style, and its ignore patterns do not describe which documents to check.
    unused.set(
      prettierSource,
      `${shown(ignoreFile!)} excludes all Markdown, so Prettier does not format Markdown here`,
    );
  else if (prettierSource === prettierFile && prettierFile) prettier = await read(prettierFile);
  else if (prettierSource) {
    sources.push(prettierSource);
    if (typeof prettierKey === "string") {
      prettierData = required(prettierKey, prettierSource);
      prettier = await read(prettierData);
    } else prettier = object(prettierKey, `the prettier key of ${shown(prettierSource)}`);
  }
  if (markdownFile && unread.has(markdownFile)) markdownlint = undefined;
  if (prettierData && unread.has(prettierData)) {
    prettier = undefined;
    // The package key only names the file that could not be read.
    if (prettierData !== prettierSource) sources.splice(sources.indexOf(prettierSource!), 1);
  }
  const ignore: string[] = [];
  if (cli2File) {
    const wrapper = await read(cli2File);
    if (
      !unread.has(cli2File) &&
      (!markdownFile ||
        directories.indexOf(path.dirname(cli2File)) <
          directories.indexOf(path.dirname(markdownFile)))
    )
      markdownlint =
        wrapper.config === undefined
          ? markdownlint
          : object(wrapper.config, `the config of ${shown(cli2File)}`);
    for (const name of ["ignores", "globs"]) {
      const patterns = wrapper[name];
      if (Array.isArray(patterns))
        for (const pattern of patterns) {
          if (typeof pattern !== "string") continue;
          if (name === "ignores" || pattern.startsWith("!")) {
            const local = name === "ignores" ? pattern : pattern.slice(1);
            ignore.push(
              ...rebase(local, cli2File),
              ...rebase(`${local.replace(/\/$/, "")}/**`, cli2File),
            );
          }
        }
    }
    if (Array.isArray(wrapper.globs)) {
      const positive = wrapper.globs.filter(
        (p): p is string => typeof p === "string" && !p.startsWith("!"),
      );
      if (positive.length) {
        const rebased = positive.flatMap((p) => rebase(p, cli2File));
        // A brace union introduces another parsing context. Do not reinterpret
        // literal commas or nest an existing alternative inside that union.
        const unsafeUnion =
          positive.length > 1 && rebased.length > 1
            ? positive.filter((p) => /[,{}]/.test(p.replace(/\\./g, "x")))
            : [];
        for (const pattern of unsafeUnion)
          omitted.push(
            `${shown(cli2File)}: pattern ${pattern} not carried over: unrepresentable combined selection.`,
          );
        if (!unsafeUnion.length && positive.every((p) => translatePattern(p, "cli2") !== undefined))
          ignore.push(
            rebased.length === 0
              ? "**"
              : rebased.length === 1
                ? `!${rebased[0]}`
                : `!{${rebased.join(",")}}`,
          );
      }
    }
    for (const key of Object.keys(wrapper))
      if (!["config", "ignores", "globs"].includes(key))
        omitted.push(`${shown(cli2File)}: ${key} not carried over.`);
  }
  const editors: { file: string; text: string }[] = [];
  for (const directory of prettier ? directories : []) {
    const file = path.join(directory, ".editorconfig");
    if (!(await exists(file))) continue;
    const text = await readFile(file, "utf8");
    editors.push({ file, text });
    if (/^\s*root\s*=\s*true\s*$/im.test(text)) break;
  }

  const overrides: Override[] = [];
  const overrideConflicts: string[] = [];
  const pragmaOverrides: { files: string[]; requirePragma: boolean }[] = [];
  const addOverride = (files: string[], values: Values) => {
    if (typeof values.requirePragma === "boolean")
      pragmaOverrides.push({ files, requirePragma: values.requirePragma });
    const converted = convertConfig({
      prettier: { ...prettier, ...values },
      ...(markdownlint ? { markdownlint } : {}),
    });
    const optionDeltas: Record<string, Values> = {};
    const ruleUpdates: Record<string, { severity?: "off" | "warn"; options?: Values }> = {};
    const options = (id: string) => {
      const setting = converted.config.rules?.[id];
      return Array.isArray(setting) ? (setting[1] as Values) : {};
    };
    if ("tabWidth" in values)
      optionDeltas["style/list-indent"] = {
        nestedIndent: options("style/list-indent").nestedIndent,
      };
    if ("singleQuote" in values) optionDeltas["style/link-title"] = options("style/link-title");
    if ("printWidth" in values) optionDeltas["style/wrap"] = { width: values.printWidth };
    if (
      typeof values.endOfLine === "string" &&
      ["lf", "crlf", "cr", "auto"].includes(values.endOfLine)
    )
      optionDeltas["style/line-ending"] = { endOfLine: values.endOfLine };
    if ("proseWrap" in values) {
      const setting = converted.config.rules?.["style/wrap"];
      ruleUpdates["style/wrap"] = {
        severity: setting ? "warn" : "off",
        options: { mode: values.proseWrap === "never" ? "never" : "always" },
      };
    }
    for (const [id, options] of Object.entries(optionDeltas))
      ruleUpdates[id] = {
        ...ruleUpdates[id],
        options: { ...ruleUpdates[id]?.options, ...options },
      };
    if (files.length) overrides.push({ files, ruleUpdates });
    omitted.push(...converted.omitted);
    overrideConflicts.push(...converted.conflicts);
  };
  const editorStates = new Map<string, Values>();
  for (const { file, text } of editors.reverse()) {
    sources.push(file);
    let patterns: string[] = [];
    let values: Values = {};
    const flush = () => {
      if (!patterns.length || !Object.keys(values).length || !patterns.some(markdownPattern)) {
        values = {};
        return;
      }
      const additions = new Map<string, Values>();
      for (const pattern of patterns) {
        additions.set(pattern, values);
        for (const [previous, state] of editorStates) {
          try {
            for (const intersection of intersectPatterns(previous, pattern))
              additions.set(intersection, { ...state, ...values });
          } catch {
            omitted.push(
              `${shown(file)}: overlapping EditorConfig sections ${previous} and ${pattern} not carried over exactly.`,
            );
          }
        }
      }
      for (const [pattern, state] of additions) {
        // Keep resolved states in emission order, including when a later section
        // updates an existing scope. Its intersections must win over older states.
        editorStates.delete(pattern);
        editorStates.set(pattern, state);
        const effective = editorOptions(state);
        for (const key of Object.keys(effective))
          if (key in (prettier ?? {})) delete effective[key];
        addOverride([pattern], effective);
      }
      values = {};
    };
    for (const line of text.split(/\r?\n/)) {
      const section = /^\s*\[(.*)\]\s*$/.exec(line);
      if (section) {
        flush();
        const pattern = section[1]!;
        patterns = rebase(pattern, file, "editorconfig");
        continue;
      }
      const entry = /^\s*([^#;=\s]+)\s*=\s*([^#;]+?)\s*$/.exec(line);
      if (!entry) continue;
      const key = entry[1]!.toLowerCase();
      const value = entry[2]!.toLowerCase();
      if (
        ["indent_size", "tab_width", "indent_style", "max_line_length", "end_of_line"].includes(key)
      )
        values[key] = value;
    }
    flush();
  }
  const used = sources.filter((file) => !unread.has(file));
  if (!used.length) {
    if (!unused.size) return undefined;
    // Nothing that was found can be used: the caller applies its defaults, and
    // the report says which files were found and why each was left out.
    return {
      ...convertConfig({}),
      config: {},
      sources: [],
      omitted: [],
      suggestions: [],
      unused: [...unused].map(([file, why]) => ({ file, reason: why })),
    };
  }
  const report = convertConfig({
    ...(markdownlint ? { markdownlint } : {}),
    ...(prettier ? { prettier } : {}),
  });
  if (prettier && Array.isArray(prettier.overrides))
    for (const [index, raw] of prettier.overrides.entries()) {
      const where = `Prettier overrides[${index}] in ${shown(prettierSource!)}`;
      const item = object(raw, where);
      const files = typeof item.files === "string" ? [item.files] : item.files;
      if (!Array.isArray(files) || !files.every((file): file is string => typeof file === "string"))
        throw new Error(`Invalid files in ${where}`);
      const rebased = files.flatMap((file) => rebase(file, prettierSource!, "prettier"));
      if (!rebased.some(markdownPattern)) continue;
      if (item.excludeFiles) omitted.push("Prettier overrides.excludeFiles: not carried over.");
      addOverride(rebased, object(item.options, `the options of ${where}`));
    }
  if (ignoreFile && ignoreText !== undefined && prettier) {
    sources.push(ignoreFile);
    omitted.push(
      `${shown(ignoreFile)}: Prettier matches its patterns without regard to letter case; the converted patterns match case exactly.`,
    );
    ignore.push(
      ...ignoreText
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith("#"))
        .flatMap((line) => {
          if (line.startsWith("!")) {
            omitted.push(
              `${shown(ignoreFile)}: negated pattern ${line} cannot be represented by independent ignore globs.`,
            );
            return [];
          }
          if (translatePattern(line, "gitignore") === undefined) {
            omitted.push(
              `${shown(ignoreFile)}: pattern ${line} not carried over: outside the supported gitignore subset.`,
            );
            return [];
          }
          const rooted = line.startsWith("/");
          const pattern = line.replace(/^\//, "").replace(/\/$/, "");
          const prefix = !rooted && !pattern.includes("/") ? "**/" : "";
          return [
            ...(!line.endsWith("/") ? rebase(`${prefix}${pattern}`, ignoreFile, "gitignore") : []),
            ...rebase(`${prefix}${pattern}/**`, ignoreFile, "gitignore"),
          ];
        }),
    );
  }
  if (prettier && overrides.length && !report.config.rules?.["style/wrap"])
    report.config = {
      ...report.config,
      rules: {
        ...report.config.rules,
        "style/wrap": ["off", { width: prettier.printWidth ?? 80, mode: "always" }],
      },
    };
  report.compatibility.pragmaOverrides = pragmaOverrides;
  // A scoped proseWrap override can enable wrapping absent from the base.
  if (prettier) report.compatibility.origins["style/wrap"] ??= ["proseWrap"];
  report.conflicts.push(...overrideConflicts);
  report.sources = [...new Set(sources.filter((file) => !unread.has(file)))];
  report.unused = [...unused].map(([file, why]) => ({ file, reason: why }));
  report.omitted = [...new Set([...report.omitted, ...omitted])];
  report.config = {
    ...report.config,
    ...(ignore.length ? { ignore } : {}),
    ...(overrides.length ? { overrides } : {}),
  } satisfies Config;
  return report;
}
