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
    ".prettierrc.jsonc",
    ".prettierrc.yaml",
    ".prettierrc.yml",
    ".prettierrc.toml",
    ".prettierrc.js",
    ".prettierrc.mjs",
    ".prettierrc.cjs",
    ".prettierrc.ts",
    ".prettierrc.mts",
    ".prettierrc.cts",
    "prettier.config.js",
    "prettier.config.mjs",
    "prettier.config.cjs",
    "prettier.config.ts",
    "prettier.config.mts",
    "prettier.config.cts",
  ],
} as const;

/** Read competitors only in directories the mdrefine search already visited, nearest first. */
export async function loadCompetitorConfig(
  directories: readonly string[],
  executeScripts = false,
): Promise<ConversionReport | undefined> {
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
        omitted.push(`${file}: JavaScript/TypeScript configuration was not executed; #669.`);
        return {};
      }
      value = ((await import(pathToFileURL(file).href)) as { default: unknown }).default;
    } else if (file.endsWith(".toml")) {
      unread.add(file);
      omitted.push(`${file}: TOML is unsupported; #669.`);
      return {};
    } else {
      const text = await readFile(file, "utf8");
      if (/\.jsonc?$/.test(file)) {
        const errors: ParseError[] = [];
        value = json(text, errors, { allowTrailingComma: true });
        if (errors.length) throw new Error(`Invalid competitor JSON in ${file}`);
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
          name.startsWith(".") || path.isAbsolute(name)
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
  for (const directory of directories) {
    if (prettierFile && path.dirname(prettierFile) === directory) {
      prettier = await read(prettierFile);
      break;
    }
    const file = path.join(directory, "package.json");
    if (!(await exists(file))) continue;
    const pkg = object(JSON.parse(await readFile(file, "utf8")) as unknown);
    if (pkg.prettier !== undefined) {
      sources.push(file);
      prettier =
        typeof pkg.prettier === "string"
          ? await read(createRequire(file).resolve(pkg.prettier))
          : object(pkg.prettier);
      break;
    }
  }
  if (markdownFile && unread.has(markdownFile)) markdownlint = undefined;
  if (prettierFile && unread.has(prettierFile)) prettier = undefined;
  const ignore: string[] = [];
  if (cli2File) {
    const wrapper = await read(cli2File);
    if (!unread.has(cli2File))
      markdownlint = {
        ...markdownlint,
        ...(wrapper.config === undefined ? {} : object(wrapper.config)),
      };
    for (const name of ["ignores", "globs"]) {
      const patterns = wrapper[name];
      if (Array.isArray(patterns))
        for (const pattern of patterns) {
          if (typeof pattern !== "string") continue;
          if (name === "ignores") ignore.push(pattern);
          else if (pattern.startsWith("!")) ignore.push(pattern.slice(1));
        }
    }
    if (Array.isArray(wrapper.globs)) {
      const positive = wrapper.globs.filter(
        (p): p is string => typeof p === "string" && !p.startsWith("!"),
      );
      if (positive.length)
        ignore.push(positive.length === 1 ? `!${positive[0]}` : `!{${positive.join(",")}}`);
    }
    for (const key of Object.keys(wrapper))
      if (!["config", "ignores", "globs"].includes(key))
        omitted.push(`${cli2File}: ${key} not carried over; #669.`);
  }
  const editors: { file: string; text: string }[] = [];
  for (const directory of directories) {
    const file = path.join(directory, ".editorconfig");
    if (!(await exists(file))) continue;
    const text = await readFile(file, "utf8");
    editors.push({ file, text });
    if (/^\s*root\s*=\s*true\s*$/im.test(text)) break;
  }
  const editor = editors.length > 0;
  const overrides: Override[] = [];
  for (const { file, text } of editors.reverse()) {
    sources.push(file);
    let patterns: string[] = [];
    let values: Values = {};
    const flush = () => {
      if (!patterns.length || !Object.keys(values).length) return;
      const converted = convertConfig({
        prettier: { ...values, ...prettier },
        ...(markdownlint ? { markdownlint } : {}),
      });
      const rules = Object.fromEntries(
        Object.entries(converted.config.rules ?? {}).filter(
          ([rule]) =>
            (rule === "style/list-indent" && "tabWidth" in values) ||
            (rule === "style/wrap" && "printWidth" in values),
        ),
      );
      overrides.push({ files: patterns, rules });
      omitted.push(...converted.omitted);
      values = {};
    };
    for (const line of text.split(/\r?\n/)) {
      const section = /^\s*\[(.*)\]\s*$/.exec(line);
      if (section) {
        flush();
        const pattern = section[1]!;
        const prefix = path
          .relative(directories.at(-1)!, path.dirname(file))
          .split(path.sep)
          .join("/");
        const local = pattern.includes("/") ? pattern.replace(/^\//, "") : `**/${pattern}`;
        patterns = [prefix ? `${prefix}/${local}` : local];
        continue;
      }
      const entry = /^\s*([^#;=\s]+)\s*=\s*([^#;]+?)\s*$/.exec(line);
      if (!entry) continue;
      const [, key, value] = entry;
      if (["indent_size", "tab_width"].includes(key!) && /^\d+$/.test(value!))
        values.tabWidth = Number(value);
      if (key === "indent_style") values.useTabs = value === "tab";
      if (key === "max_line_length" && /^\d+$/.test(value!)) values.printWidth = Number(value);
      if (key === "end_of_line") values.endOfLine = value;
    }
    flush();
  }
  if (!markdownlint && !prettier && !editor && !sources.length) return undefined;
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
      if (item.excludeFiles)
        omitted.push("Prettier overrides.excludeFiles: not carried over; #669.");
      const converted = convertConfig({
        prettier: { ...prettier, ...object(item.options) },
        ...(markdownlint ? { markdownlint } : {}),
      });
      overrides.push({
        files: files.map((file) => (file.includes("/") ? file : `**/${file}`)),
        rules: {
          ...converted.config.rules,
          "style/wrap": converted.config.rules?.["style/wrap"] ?? "off",
        },
      });
      omitted.push(...converted.omitted);
      report.conflicts.push(...converted.conflicts);
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
              `${ignoreFile}: negated pattern ${line} cannot be represented by independent ignore globs; #669.`,
            );
            return [];
          }
          const rooted = line.startsWith("/");
          const pattern = line.replace(/^\//, "").replace(/\/$/, "");
          const prefix = !rooted && !pattern.includes("/") ? "**/" : "";
          return [`${prefix}${pattern}`, `${prefix}${pattern}/**`];
        }),
    );
  }
  report.sources = [...new Set(sources)];
  report.omitted = [...new Set([...report.omitted, ...omitted])];
  report.config = {
    ...report.config,
    ...(ignore.length ? { ignore } : {}),
    ...(overrides.length ? { overrides } : {}),
  } satisfies Config;
  return report;
}
