import { access, constants, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { parse, printParseErrorCode } from "jsonc-parser";
import type { ParseError } from "jsonc-parser";
import type { Config, Plugin } from "../core/types.js";
import { configProblem, validateConfig } from "./resolve.js";
import { exists, pathError, refusal, refusalText } from "../workspace/access.js";
import { isVault } from "../workspace/vault.js";

export interface LoadedConfig {
  config: Config;
  plugins: Plugin[];
  root: string;
  file?: string;
}
export async function loadConfig(start: string, explicit?: string): Promise<LoadedConfig> {
  let file = explicit ? path.resolve(explicit) : undefined;
  let fallbackRoot = path.resolve(start);
  if (!file) {
    let directory = path.resolve(start);
    for (;;) {
      const found: string[] = [];
      let boundary: boolean;
      try {
        for (const name of ["mdtools.config.jsonc", "mdtools.config.json", "mdtools.config.mjs"])
          if (await exists(path.join(directory, name))) found.push(path.join(directory, name));
        // A repository or an Obsidian vault is a workspace of its own.
        boundary =
          !found.length &&
          ((await exists(path.join(directory, ".git"))) || (await isVault(directory)));
      } catch (error) {
        // Default rules must not take the place of a configuration that may be there.
        const code = refusal(error);
        if (!code) throw error;
        throw new Error(
          `Cannot look for a configuration file in ${directory} (${refusalText(code)})`,
          { cause: error },
        );
      }
      if (found.length > 1)
        throw new Error(`Multiple mdtools configuration files in ${directory}. Use --config.`);
      if (found.length) {
        file = found[0];
        break;
      }
      if (boundary) {
        fallbackRoot = directory;
        break;
      }
      if (path.dirname(directory) === directory) break;
      directory = path.dirname(directory);
    }
  }
  // The file as the user named it, or where the search found it.
  const shown = explicit ?? file;
  let value: unknown = {};
  if (file && shown) {
    let text = "";
    try {
      if (!(await stat(file)).isFile())
        throw new Error(`Configuration file is not a file: ${shown}`);
      // A script is read by Node.js itself; its refusal would not name the file.
      if (file.endsWith(".mjs")) await access(file, constants.R_OK);
      else text = await readFile(file, "utf8");
    } catch (error) {
      throw pathError("Configuration file", shown, error);
    }
    if (file.endsWith(".mjs")) {
      try {
        value = ((await import(pathToFileURL(file).href)) as { default: unknown }).default;
      } catch (error) {
        throw new Error(
          `Cannot load configuration file ${shown}: ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        );
      }
    } else {
      const errors: ParseError[] = [];
      value = parse(text, errors, {
        allowTrailingComma: true,
        disallowComments: file.endsWith(".json"),
      });
      if (errors.length)
        throw new Error(
          `Invalid JSON configuration in ${shown}: ${errors.map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`).join(", ")}`,
        );
    }
    const problem = configProblem(value);
    if (problem) throw new Error(`Invalid configuration in ${shown}: ${problem}`);
  }
  validateConfig(value);
  const root = file ? path.dirname(file) : fallbackRoot;
  const plugins: Plugin[] = [];
  // Only a configuration file can name plugins, so there is a file to resolve them from.
  if (file)
    for (const specifier of value.plugins ?? []) plugins.push(await loadPlugin(specifier, file));
  return { config: value, plugins, root, ...(file ? { file } : {}) };
}

/**
 * The conditions Node.js applies to the `exports` of a package it imports, as of Node.js
 * 22.12. Node.js has no supported way to ask for them or to resolve from another file.
 */
const importConditions = new Set(["node", "import", "module-sync", "node-addons"]);

/** The URL of the module that `specifier` names in the configuration file `file`. */
async function locatePlugin(specifier: string, file: string): Promise<string> {
  // A path is taken as written, not as a URL, so "%", "#", and "?" in a file name stay literal.
  if (specifier.startsWith(".") || path.isAbsolute(specifier))
    return pathToFileURL(path.resolve(path.dirname(file), specifier)).href;
  // Loaded only here, so that a run that names no package does not pay for the resolver.
  const { moduleResolve } = await import("import-meta-resolve");
  try {
    // The module is imported, so its name is resolved as an import written in the
    // configuration file would be: a package's `import` entry wins over its `require` entry.
    return moduleResolve(specifier, pathToFileURL(file), importConditions).href;
  } catch (error) {
    // CommonJS resolution finds what an import does not: an entry that is only declared for
    // `require`, a file named without its extension, a directory, and NODE_PATH.
    try {
      return pathToFileURL(createRequire(file).resolve(specifier)).href;
    } catch {
      throw error;
    }
  }
}

async function loadPlugin(specifier: string, file: string): Promise<Plugin> {
  let plugin: unknown;
  try {
    plugin = ((await import(await locatePlugin(specifier, file))) as { default?: unknown }).default;
  } catch (error) {
    throw new Error(
      `Cannot load plugin "${specifier}" named in ${file}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (
    !plugin ||
    typeof plugin !== "object" ||
    !("name" in plugin) ||
    typeof plugin.name !== "string"
  )
    throw new Error(
      `Invalid plugin "${specifier}" named in ${file}: its default export must be an object with a string "name".`,
    );
  return plugin as Plugin;
}
