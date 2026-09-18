import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { parse, printParseErrorCode } from "jsonc-parser";
import type { ParseError } from "jsonc-parser";
import type { Config, Plugin } from "../core/types.js";
import { validateConfig } from "./resolve.js";

export interface LoadedConfig {
  config: Config;
  plugins: Plugin[];
  root: string;
  file?: string;
}
export async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
export async function loadConfig(start: string, explicit?: string): Promise<LoadedConfig> {
  let file = explicit ? path.resolve(explicit) : undefined;
  let fallbackRoot = path.resolve(start);
  if (!file) {
    let directory = path.resolve(start);
    for (;;) {
      const found: string[] = [];
      for (const name of ["mdtools.config.jsonc", "mdtools.config.json", "mdtools.config.mjs"])
        if (await exists(path.join(directory, name))) found.push(path.join(directory, name));
      if (found.length > 1)
        throw new Error(`Multiple mdtools configuration files in ${directory}. Use --config.`);
      if (found.length) {
        file = found[0];
        break;
      }
      if (
        (await exists(path.join(directory, ".git"))) ||
        (await exists(path.join(directory, ".obsidian")))
      ) {
        fallbackRoot = directory;
        break;
      }
      if (path.dirname(directory) === directory) break;
      directory = path.dirname(directory);
    }
  }
  let value: unknown = {};
  if (file?.endsWith(".mjs"))
    value = ((await import(pathToFileURL(file).href)) as { default: unknown }).default;
  else if (file) {
    const errors: ParseError[] = [];
    value = parse(await readFile(file, "utf8"), errors, {
      allowTrailingComma: true,
      disallowComments: file.endsWith(".json"),
    });
    if (errors.length)
      throw new Error(
        `Invalid JSON configuration: ${errors.map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`).join(", ")}`,
      );
  }
  validateConfig(value);
  const root = file ? path.dirname(file) : fallbackRoot;
  const plugins: Plugin[] = [];
  const require = createRequire(path.join(root, "mdtools.config.mjs"));
  for (const specifier of value.plugins ?? []) {
    const location =
      specifier.startsWith(".") || path.isAbsolute(specifier)
        ? path.resolve(root, specifier)
        : require.resolve(specifier);
    const plugin: unknown = ((await import(pathToFileURL(location).href)) as { default: unknown })
      .default;
    if (
      !plugin ||
      typeof plugin !== "object" ||
      !("name" in plugin) ||
      typeof plugin.name !== "string"
    )
      throw new Error(`Invalid plugin export: ${specifier}`);
    plugins.push(plugin as Plugin);
  }
  return { config: value, plugins, root, ...(file ? { file } : {}) };
}
