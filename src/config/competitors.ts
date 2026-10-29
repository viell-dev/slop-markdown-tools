import { GLOBSTAR, Minimatch } from "minimatch";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { parse as json, type ParseError } from "jsonc-parser";
import { parse as yaml } from "yaml";
import { exists } from "../workspace/access.js";
import { convertConfig, type ConversionReport } from "./convert.js";
import type { Config, Override } from "../core/types.js";

type Values = Record<string, unknown>;
const object = (value: unknown): Values => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a configuration object");
  return value as Values;
};
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
  const rebase = (
    pattern: string,
    file: string,
    dialect: PatternDialect = "cli2",
    expandPrettier = true,
  ): string[] => {
    const translated = translatePattern(pattern, dialect);
    if (translated === undefined) {
      omitted.push(
        `${file}: pattern ${pattern} not carried over: outside the supported ${dialect} subset.`,
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
      omitted.push(`${file}: pattern ${pattern} not carried over: unrelated source directory.`);
      return [];
    }
    // Consume the destination's literal path in the glob's finite-state matcher.
    // A globstar can consume a component or leave it for the following component.
    const results: string[] = [];
    const matcher = new Minimatch(local, { dot: true });
    if (matcher.negate || matcher.comment) {
      omitted.push(
        `${file}: pattern ${pattern} not carried over: cannot express its subtree intersection.`,
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
  const read = async (file: string, chain: string[] = []): Promise<Values> => {
    if (chain.includes(file))
      throw new Error(`Cyclic competitor extends: ${[...chain, file].join(" -> ")}`);
    sources.push(file);
    let value: unknown;
    if (/\.[cm]?[jt]s$/.test(file)) {
      if (!executeScripts) {
        unread.add(file);
        omitted.push(`${file}: JavaScript/TypeScript configuration was not executed.`);
        return {};
      }
      value = ((await import(pathToFileURL(file).href)) as { default: unknown }).default;
    } else if (/\.(toml|json5)$/.test(file)) {
      unread.add(file);
      omitted.push(`${file}: ${file.endsWith(".toml") ? "TOML" : "JSON5"} is unsupported.`);
      return {};
    } else {
      const text = await readFile(file, "utf8");
      if (/\.jsonc?$/.test(file)) {
        const errors: ParseError[] = [];
        value = json(text, errors, { allowTrailingComma: true });
        if (errors.length)
          throw new Error(
            `Invalid competitor JSON in ${file}; use --no-competitor-config to bypass conversion.`,
          );
      } else value = text.trim() ? (yaml(text) as unknown) : {};
    }
    const result = object(value);
    const nested =
      file.includes("-cli2.") && result.config !== undefined ? object(result.config) : result;
    if (nested.extends !== undefined) {
      const names = Array.isArray(nested.extends) ? nested.extends : [nested.extends];
      let base: Values = {};
      for (const name of names) {
        if (typeof name !== "string") throw new Error(`Invalid extends in ${file}`);
        const resolved =
          (await exists(path.resolve(path.dirname(file), name))) || path.isAbsolute(name)
            ? path.resolve(path.dirname(file), name)
            : createRequire(file).resolve(name);
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
  let prettierSource = prettierFile;
  for (const directory of directories) {
    for (const name of ["package.json", "package.yaml"]) {
      const file = path.join(directory, name);
      if (!(await exists(file))) continue;
      let pkg: Values;
      try {
        const text = await readFile(file, "utf8");
        pkg = object(
          name.endsWith("json") ? (JSON.parse(text) as unknown) : (yaml(text) as unknown),
        );
      } catch {
        continue;
      }
      if (pkg.prettier === undefined) continue;
      sources.push(file);
      prettierSource = file;
      prettier =
        typeof pkg.prettier === "string"
          ? await read(createRequire(file).resolve(pkg.prettier))
          : object(pkg.prettier);
      break;
    }
    if (prettier) break;
    if (prettierFile && path.dirname(prettierFile) === directory) {
      prettier = await read(prettierFile);
      break;
    }
  }
  if (markdownFile && unread.has(markdownFile)) markdownlint = undefined;
  if (prettierFile && unread.has(prettierFile)) prettier = undefined;
  const ignore: string[] = [];
  if (cli2File) {
    const wrapper = await read(cli2File);
    if (
      !unread.has(cli2File) &&
      (!markdownFile ||
        directories.indexOf(path.dirname(cli2File)) <
          directories.indexOf(path.dirname(markdownFile)))
    )
      markdownlint = wrapper.config === undefined ? markdownlint : object(wrapper.config);
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
            `${cli2File}: pattern ${pattern} not carried over: unrepresentable combined selection.`,
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
        omitted.push(`${cli2File}: ${key} not carried over.`);
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
              `${file}: overlapping EditorConfig sections ${previous} and ${pattern} not carried over exactly.`,
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
  if (!markdownlint && !prettier && !sources.length) return undefined;
  const report = convertConfig({
    ...(markdownlint ? { markdownlint } : {}),
    ...(prettier ? { prettier } : {}),
  });
  if (prettier && Array.isArray(prettier.overrides))
    for (const raw of prettier.overrides) {
      const item = object(raw);
      const files = typeof item.files === "string" ? [item.files] : item.files;
      if (!Array.isArray(files) || !files.every((file): file is string => typeof file === "string"))
        throw new Error("Invalid Prettier override files");
      const rebased = files.flatMap((file) => rebase(file, prettierSource!, "prettier"));
      if (!rebased.some(markdownPattern)) continue;
      if (item.excludeFiles) omitted.push("Prettier overrides.excludeFiles: not carried over.");
      addOverride(rebased, object(item.options));
    }
  const ignoreFile = await find([".prettierignore"]);
  if (ignoreFile && prettier) {
    sources.push(ignoreFile);
    omitted.push(
      `${ignoreFile}: Prettier matches its patterns without regard to letter case; the converted patterns match case exactly.`,
    );
    ignore.push(
      ...(await readFile(ignoreFile, "utf8"))
        .split(/\r?\n/)
        .filter((line) => line && !line.startsWith("#"))
        .flatMap((line) => {
          if (line.startsWith("!")) {
            omitted.push(
              `${ignoreFile}: negated pattern ${line} cannot be represented by independent ignore globs.`,
            );
            return [];
          }
          if (translatePattern(line, "gitignore") === undefined) {
            omitted.push(
              `${ignoreFile}: pattern ${line} not carried over: outside the supported gitignore subset.`,
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
  report.sources = [...new Set(sources)];
  report.omitted = [...new Set([...report.omitted, ...omitted])];
  report.config = {
    ...report.config,
    ...(ignore.length ? { ignore } : {}),
    ...(overrides.length ? { overrides } : {}),
  } satisfies Config;
  return report;
}
