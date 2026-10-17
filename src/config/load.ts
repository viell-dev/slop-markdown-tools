import { access, constants, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { parse, printParseErrorCode } from "jsonc-parser";
import type { ParseError } from "jsonc-parser";
import type { Config, Plugin } from "../core/types.js";
import { configProblem, validateConfig } from "./resolve.js";
import { reservedPluginName } from "../core/engine.js";
import { exists, pathError, refusal, refusalText } from "../workspace/access.js";
import { isVault } from "../workspace/vault.js";
import { splitByteOrderMark } from "../syntax/parse.js";

export interface LoadedConfig {
  config: Config;
  plugins: Plugin[];
  root: string;
  file?: string;
}
/** The names of the configuration files that the search finds; one directory may hold one. */
export const configFiles = [
  "mdtools.config.jsonc",
  "mdtools.config.json",
  "mdtools.config.mjs",
  "mdtools.config.js",
  "mdtools.config.cjs",
];
/**
 * Whether Node.js loads `file` as JavaScript. A `.js` file is an ES module or
 * CommonJS as Node.js decides from the nearest `package.json`; either way,
 * importing it gives its default export or its `module.exports`.
 */
const isScript = (file: string) => /\.[cm]?js$/i.test(file);
/** The 1-based line and column, in UTF-16 code units, of `offset` in `text`. */
function position(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let start = 0;
  for (const match of text.slice(0, offset).matchAll(/\r\n|\r|\n/g)) {
    line++;
    start = match.index + match[0].length;
  }
  return { line, column: offset - start + 1 };
}
const syntaxProblems: Partial<Record<ReturnType<typeof printParseErrorCode>, string>> = {
  InvalidNumberFormat: "the number is not written as JSON writes numbers",
  PropertyNameExpected: "a property name in double quotes is expected",
  ValueExpected: "a value is expected",
  ColonExpected: "a colon is expected",
  CommaExpected: "a comma is expected",
  CloseBraceExpected: "a closing brace is expected",
  CloseBracketExpected: "a closing bracket is expected",
  EndOfFileExpected: "the file should end here",
  InvalidCommentToken: "a .json file cannot hold comments; name it .jsonc to keep them",
  UnexpectedEndOfComment: "the comment is not closed",
  UnexpectedEndOfString: "the string is not closed on its line",
  UnexpectedEndOfNumber: "the number is incomplete",
  InvalidUnicode: "the Unicode escape is invalid",
  InvalidEscapeCharacter: "the escape sequence is invalid",
  InvalidCharacter: "a control character in a string must be escaped",
};
/** A JSON syntax error in plain words. */
function syntaxProblem(text: string, error: ParseError): string {
  const code = printParseErrorCode(error.error);
  // Text such as an unquoted name or a single-quoted string, which JSON does not have.
  if (code === "InvalidSymbol")
    return `${JSON.stringify(text.slice(error.offset, error.offset + Math.min(error.length, 40)))} is not valid JSON here`;
  return syntaxProblems[code] ?? code;
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
        for (const name of configFiles)
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
    const script = isScript(file);
    try {
      if (!(await stat(file)).isFile())
        throw new Error(`Configuration file is not a file: ${shown}`);
      // A script is read by Node.js itself; its refusal would not name the file.
      if (script) await access(file, constants.R_OK);
      else text = await readFile(file, "utf8");
    } catch (error) {
      throw pathError("Configuration file", shown, error);
    }
    if (script) {
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
      // RFC 8259 lets a parser ignore a byte order mark, which some Windows
      // programs write at the start of a UTF-8 file; error offsets count after it.
      const json = splitByteOrderMark(text)[1];
      value = parse(json, errors, {
        allowTrailingComma: true,
        disallowComments: file.endsWith(".json"),
      });
      // The errors after the first mostly follow from it, as the parser recovers.
      const [first] = errors;
      if (first) {
        const { line, column } = position(json, first.offset);
        throw new Error(
          `Invalid JSON configuration in ${shown} at line ${line}, column ${column}: ${syntaxProblem(json, first)}`,
        );
      }
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
 * The options of `NODE_OPTIONS`, split as Node.js splits them: at spaces, except inside double
 * quotes, where a backslash takes the next character literally.
 */
function splitNodeOptions(value: string): string[] {
  const options: string[] = [];
  let quoted = false;
  let fresh = true;
  for (let index = 0; index < value.length; index++) {
    let character = value[index]!;
    if (quoted && character === "\\" && index + 1 < value.length) character = value[++index]!;
    else if (character === " " && !quoted) {
      fresh = true;
      continue;
    } else if (character === '"') {
      quoted = !quoted;
      continue;
    }
    // Like Node.js, an option starts with its first character, so `""` alone is none.
    if (fresh) options.push(character);
    else options[options.length - 1] += character;
    fresh = false;
  }
  return options;
}
/**
 * The conditions Node.js applies to the `exports` of a package it imports: its defaults, as of
 * Node.js 22.12, changed by the options the process was started with. `--conditions` (`-C`)
 * adds one and `--no-addons` takes `node-addons` away, on the command line or in
 * `NODE_OPTIONS`. Node.js has no supported way to ask for the conditions in effect or to
 * resolve from another file, so they are worked out here.
 */
export function importConditions(
  execArgv: readonly string[] = process.execArgv,
  nodeOptions: string | undefined = process.env.NODE_OPTIONS,
): Set<string> {
  const conditions = new Set(["node", "import", "module-sync", "node-addons"]);
  const options = [...splitNodeOptions(nodeOptions ?? ""), ...execArgv];
  for (let index = 0; index < options.length; index++) {
    const option = options[index]!;
    // Node.js takes the value after `=` or as the next option; `-C` only as the next.
    const named = /^--conditions(?:=(.*))?$/s.exec(option);
    if (named || option === "-C") {
      const condition = named?.[1] ?? options[++index];
      if (condition) conditions.add(condition);
    } else if (option === "--no-addons") conditions.delete("node-addons");
    else if (option === "--addons") conditions.add("node-addons");
  }
  return conditions;
}

/** The URL of the module that `specifier` names in the configuration file `file`. */
async function locatePlugin(specifier: string, file: string): Promise<string> {
  // A path is taken as written, not as a URL, so "%", "#", and "?" in a file name stay literal.
  if (specifier.startsWith(".") || path.isAbsolute(specifier)) {
    const named = path.resolve(path.dirname(file), specifier);
    // Node.js's reason for a file that is not there ends with the importing file, which
    // here is this one and means nothing to the user.
    // The check's own failure, such as a refusal, names the path and is reported as it is.
    if (!(await exists(named)) || !(await stat(named)).isFile())
      throw new Error(`no file at ${named}`);
    return pathToFileURL(named).href;
  }
  // Loaded only here, so that a run that names no package does not pay for the resolver.
  const { moduleResolve } = await import("import-meta-resolve");
  try {
    // The module is imported, so its name is resolved as an import written in the
    // configuration file would be: a package's `import` entry wins over its `require` entry.
    return moduleResolve(specifier, pathToFileURL(file), importConditions()).href;
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
  if (plugin.name === reservedPluginName)
    throw new Error(
      `Invalid plugin "${specifier}" named in ${file}: its name, ${reservedPluginName}, is reserved for the engine's own diagnostics.`,
    );
  return plugin as Plugin;
}
