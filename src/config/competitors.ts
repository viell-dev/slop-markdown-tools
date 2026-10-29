import { Minimatch } from "minimatch";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { parse as json, type ParseError } from "jsonc-parser";
import { parse as yaml } from "yaml";
import { exists } from "../workspace/access.js";
import { convertConfig, type ConversionReport } from "./convert.js";
import type { Config, Override, RuleSetting } from "../core/types.js";

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
/** Read competitors only in directories the mdrefine search already visited, nearest first. */
export async function loadCompetitorConfig(
  directories: readonly string[],
  executeScripts = false,
  destination = directories.at(-1)!,
): Promise<ConversionReport | undefined> {
  const rebase = (pattern: string, file: string) => {
    const prefix = path.relative(destination, path.dirname(file)).split(path.sep).join("/");
    const local = pattern.replace(/^\//, "");
    return prefix ? `${prefix}/${local}` : local;
  };
  const sources: string[] = [];
  const omitted: string[] = [];
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
            const local = rebase(name === "ignores" ? pattern : pattern.slice(1), cli2File);
            ignore.push(local, `${local.replace(/\/$/, "")}/**`);
          }
        }
    }
    if (Array.isArray(wrapper.globs)) {
      const positive = wrapper.globs.filter(
        (p): p is string => typeof p === "string" && !p.startsWith("!"),
      );
      if (positive.length)
        ignore.push(
          positive.length === 1
            ? `!${rebase(positive[0]!, cli2File)}`
            : `!{${positive.map((p) => rebase(p, cli2File)).join(",")}}`,
        );
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
  const addOverride = (files: string[], values: Values) => {
    const converted = convertConfig({
      prettier: { ...prettier, ...values },
      ...(markdownlint ? { markdownlint } : {}),
    });
    const ruleOptions: Record<string, Values> = {};
    const rules: Record<string, RuleSetting> = {};
    const options = (id: string) => {
      const setting = converted.config.rules?.[id];
      return Array.isArray(setting) ? (setting[1] as Values) : {};
    };
    if ("tabWidth" in values)
      ruleOptions["style/list-indent"] = {
        nestedIndent: options("style/list-indent").nestedIndent,
      };
    if ("singleQuote" in values) ruleOptions["style/link-title"] = options("style/link-title");
    if ("printWidth" in values) ruleOptions["style/wrap"] = { width: values.printWidth };
    if (
      typeof values.endOfLine === "string" &&
      ["lf", "crlf", "cr", "auto"].includes(values.endOfLine)
    )
      ruleOptions["style/line-ending"] = { endOfLine: values.endOfLine };
    if ("proseWrap" in values) {
      const setting = converted.config.rules?.["style/wrap"];
      rules["style/wrap"] = [
        setting ? "warn" : "off",
        { mode: values.proseWrap === "never" ? "never" : "always" },
      ];
    }
    overrides.push({ files, mergeRuleOptions: true, rules, ruleOptions });
    omitted.push(...converted.omitted);
    overrideConflicts.push(...converted.conflicts);
  };
  for (const { file, text } of editors.reverse()) {
    sources.push(file);
    let patterns: string[] = [];
    let values: Values = {};
    const flush = () => {
      if (!patterns.length || !Object.keys(values).length || !patterns.some(markdownPattern)) {
        values = {};
        return;
      }
      const effective = Object.fromEntries(
        Object.entries(values).filter(([key]) => !(key in (prettier ?? {}))),
      );
      addOverride(patterns, effective);
      values = {};
    };
    for (const line of text.split(/\r?\n/)) {
      const section = /^\s*\[(.*)\]\s*$/.exec(line);
      if (section) {
        flush();
        const pattern = section[1]!;
        const local = pattern.includes("/") ? pattern.replace(/^\//, "") : `**/${pattern}`;
        patterns = [rebase(local, file)];
        continue;
      }
      const entry = /^\s*([^#;=\s]+)\s*=\s*([^#;]+?)\s*$/.exec(line);
      if (!entry) continue;
      const [, key, value] = entry;
      if (["indent_size", "tab_width"].includes(key!) && /^\d+$/.test(value!))
        values.tabWidth = Number(value);
      if (key === "indent_style") values.useTabs = value === "tab";
      if (key === "max_line_length" && (/^\d+$/.test(value!) || value === "unset"))
        values.printWidth = value === "unset" ? 80 : Number(value);
      if (["indent_size", "tab_width"].includes(key!) && value === "unset") values.tabWidth = 2;
      if (key === "end_of_line") values.endOfLine = value;
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
      if (!files.some(markdownPattern)) continue;
      if (item.excludeFiles) omitted.push("Prettier overrides.excludeFiles: not carried over.");
      addOverride(
        files.map((file) => rebase(file.includes("/") ? file : `**/${file}`, prettierSource!)),
        object(item.options),
      );
    }
  const ignoreFile = await find([".prettierignore"]);
  if (ignoreFile && prettier) {
    sources.push(ignoreFile);
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
          const rooted = line.startsWith("/");
          const pattern = line.replace(/^\//, "").replace(/\/$/, "");
          const prefix = !rooted && !pattern.includes("/") ? "**/" : "";
          return [
            rebase(`${prefix}${pattern}`, ignoreFile),
            rebase(`${prefix}${pattern}/**`, ignoreFile),
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
