#!/usr/bin/env node
import { Command, CommanderError, InvalidArgumentError, Option } from "commander";
import { createTwoFilesPatch } from "diff";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format, lint, ruleRegistry } from "../core/engine.js";
import { loadConfig } from "../config/load.js";
import { dialectAliases, dialects, resolveConfig } from "../config/resolve.js";
import {
  replacementFailure,
  replacementProblem,
  skippedMessage,
  writeFormatted,
} from "../workspace/files.js";
import { assumedDialect, checkRoot, discoverFrom } from "../workspace/discovery.js";
import { enclosingVault } from "../workspace/vault.js";
import { refusal, refusalText } from "../workspace/access.js";
import { decodeText, NotUtf8Error } from "../workspace/encoding.js";
import type { Diagnostic, DialectName } from "../core/types.js";

interface Flags {
  config?: string;
  root?: string;
  dialect?: DialectName;
  json?: boolean;
  check?: boolean;
  diff?: boolean;
  write?: boolean;
  stdinFilepath?: string;
  maxWarnings?: number;
  exclude?: string[];
  quiet?: boolean;
  fix?: boolean;
}
const manifest = JSON.parse(
  await readFile(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
) as { version: string };
// Subcommands inherit these settings, so they come before the commands.
const program = new Command()
  .name("mdtools")
  .description("Lint and format Markdown with explicit dialects and configurable rules.")
  .version(manifest.version, "-V, --version", "Print the version")
  .helpOption("-h, --help", "Print help for the command")
  .helpCommand("help [command]", "Print help for a command")
  // Commander starts its messages with "error: ", the tool with its name.
  .configureOutput({
    outputError: (text, write) => write(`mdtools: ${text.replace(/^error: /, "")}`),
  })
  // Throw instead of exiting, so that a usage error can end with code 2.
  .exitOverride();
const configOption = [
  "--config <file>",
  "Use this JSON, JSONC, or .mjs configuration file instead of searching for one",
] as const;
/** The dialects, each with its other names, as in "forgejo (alias: codeberg)". */
const dialectList = dialects
  .map((dialect) => {
    const aliases = Object.keys(dialectAliases).filter((name) => dialectAliases[name] === dialect);
    return aliases.length ? `${dialect} (alias: ${aliases.join(", ")})` : dialect;
  })
  .join(", ");
/** The options that choose the configuration, the workspace, and the dialect. */
function workspaceOptions(command: Command): Command {
  return command
    .option(...configOption)
    .option(
      "--root <directory>",
      "Workspace root (default: the configuration file's directory; without one, the Git repository or vault where the search stopped, else the current directory)",
    )
    .option(
      "--dialect <dialect>",
      `${dialectList} (when none is named: github, or obsidian inside a vault)`,
      (value: string) => {
        if (!Object.hasOwn(dialectAliases, value) && !(dialects as string[]).includes(value))
          throw new InvalidArgumentError(`The dialects are ${dialectList}.`);
        return value as DialectName;
      },
    );
}
function common(command: Command): Command {
  return (
    workspaceOptions(command)
      .option(
        "--exclude <path>",
        "Exclude an exact file or directory (repeatable)",
        (value: string, previous: string[] = []) => [...previous, value],
      )
      .option("--json", "Machine-readable output")
      .option("--quiet", "Report errors only: leave warnings out of the report and its counts")
      .option("--stdin-filepath <file>", "Filename context for stdin")
      .option(
        "--max-warnings <count>",
        "Fail when warning count exceeds this nonnegative integer",
        (value: string) => {
          const number = Number(value);
          if (!Number.isInteger(number) || number < 0)
            throw new Error("--max-warnings must be a nonnegative integer.");
          return number;
        },
      )
      // Not an option: `run` answers it with the option that does what it asks for.
      .addOption(new Option("--fix").hideHelp())
  );
}
/**
 * The configuration and workspace root that the options name. `--dialect` is
 * applied to a copy, because an .mjs configuration may export a frozen object.
 */
async function workspace(flags: Flags) {
  // Without this check the first thing to fail would be the search for a
  // configuration file in the root, with a message about a file the user never named.
  if (flags.root !== undefined) await checkRoot(flags.root);
  const loaded = await loadConfig(path.resolve(flags.root ?? "."), flags.config);
  return {
    ...loaded,
    root: path.resolve(flags.root ?? loaded.root),
    config: flags.dialect ? { ...loaded.config, dialect: flags.dialect } : loaded.config,
  };
}
/**
 * The real path of `file`, which need not exist: the real path of the nearest
 * directory above it that does, with the rest of `file` appended.
 */
async function located(file: string): Promise<string> {
  const rest: string[] = [];
  for (let current = path.resolve(file); ;) {
    try {
      return path.join(await realpath(current), ...rest);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(file);
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}
/**
 * The path of `file`, which need not exist, from the workspace root, with
 * forward slashes, or undefined when it lies outside. Both are located through
 * their real paths, as discovery locates files, so that a root reached through
 * a link still holds the files below it.
 */
async function workspacePath(root: string, file: string): Promise<string | undefined> {
  const actual = await realpath(root).catch(() => root);
  const name = path
    .relative(actual, await located(file))
    .split(path.sep)
    .join("/");
  return name === ".." || name.startsWith("../") || path.isAbsolute(name) ? undefined : name;
}
/** The library's diagnostics for a document that it could not process as configured. */
const failures = new Set(["engine/unsafe-format", "engine/rule-error"]);
interface Report {
  path: string;
  changed?: boolean;
  diagnostics: Diagnostic[];
  output?: string;
}
async function run(mode: "lint" | "format", inputs: string[], flags: Flags) {
  // ESLint and markdownlint-cli2 fix with --fix, Prettier with --write.
  if (flags.fix)
    throw new Error(
      mode === "lint"
        ? "unknown option '--fix': lint never changes files; 'mdtools format --write' applies the fixes."
        : "unknown option '--fix': format writes its changes with --write.",
    );
  if ([flags.check, flags.diff, flags.write].filter(Boolean).length > 1)
    throw new Error("Choose only one of --check, --diff, and --write.");
  if (inputs.includes("-") && flags.exclude?.length)
    throw new Error("--exclude cannot be combined with stdin.");
  const { root, ...loaded } = await workspace(flags);
  const stdin = inputs.includes("-");
  if (stdin && (inputs.length !== 1 || flags.write))
    throw new Error("stdin must be the only input and cannot be combined with --write.");
  /** The text read from stdin, by the name it is given in the workspace. */
  let documents: Record<string, string> | undefined;
  if (stdin) {
    const name = await workspacePath(root, flags.stdinFilepath ?? path.join(root, "stdin.md"));
    if (name === undefined) throw new Error("--stdin-filepath must be within the workspace.");
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    try {
      documents = { [name]: decodeText(Buffer.concat(chunks), "stdin") };
    } catch (error) {
      // There is no file to report it for, and nothing else to process.
      if (error instanceof NotUtf8Error)
        throw new Error(`stdin is not UTF-8 text (${error.reason})`, { cause: error });
      throw error;
    }
  }
  // Paths on the command line are relative to the working directory, and no
  // path selects the whole workspace; stdin is the only document then.
  const discovery = await discoverFrom(
    {
      root,
      ...(stdin ? { inputs: [] } : inputs.length ? { inputs } : {}),
      exclude: flags.exclude ?? [],
      config: loaded.config,
      plugins: loaded.plugins,
      ...(documents ? { documents } : {}),
    },
    process.cwd(),
  );
  const reports: Report[] = [];
  const changes: { file: string; before: string; after: string }[] = [];
  // Selected files that the system refused to let the tool read, or that are not UTF-8 text.
  const unread: string[] = [];
  for (const name of discovery.selected) {
    const options = discovery.options(name);
    let source: string;
    try {
      source = discovery.read(name);
    } catch (error) {
      // Report the file and carry on with the others; any other error is a fault.
      const code = refusal(error);
      const problem = code
        ? `could not be read (${refusalText(code)})`
        : error instanceof NotUtf8Error
          ? `is not UTF-8 text (${error.reason})`
          : undefined;
      if (!problem) throw error;
      unread.push(name);
      reports.push({
        path: name,
        ...(mode === "format" ? { changed: false } : {}),
        diagnostics: [
          {
            start: 0,
            message: `The file ${problem} and was not ${mode === "lint" ? "linted" : "formatted"}.`,
            rule: "engine/unreadable-file",
            severity: "error",
            line: 1,
            column: 1,
          },
        ],
      });
      continue;
    }
    if (mode === "lint") reports.push({ path: name, diagnostics: lint(source, options) });
    else {
      const result = format(source, options);
      reports.push({
        path: name,
        changed: result.changed,
        diagnostics: result.diagnostics,
        ...(stdin && !flags.check ? { output: result.output } : {}),
      });
      if (result.changed) changes.push({ file: name, before: source, after: result.output });
    }
  }
  // A document that could not be read, had a rule refused or failing on it, or
  // could not be written is a failure to operate, reported for its own file,
  // and the run ends with status 2. Files do not depend on one another's
  // content, so every other changed document is still written, and so is the
  // result of one with a refused or failing rule, which the engine checked.
  const failed =
    unread.length > 0 ||
    reports.some((report) => report.diagnostics.some((item) => failures.has(item.rule)));
  // Changed files that could not be written, each reported for its file.
  const unwritten: string[] = [];
  const refuse = (file: string, message: string) => {
    unwritten.push(file);
    reports
      .find((report) => report.path === file)!
      .diagnostics.unshift({
        start: 0,
        message: `${message}.`,
        rule: "engine/unwritable-file",
        severity: "error",
        line: 1,
        column: 1,
      });
  };
  // The files that were written, in the order of the report.
  const written: string[] = [];
  if (flags.write)
    for (const change of changes) {
      const file = path.join(discovery.root, change.file);
      // A file that may not be written, such as a read-only one, is left alone.
      const problem = await replacementProblem(file);
      if (problem) {
        refuse(change.file, `${problem}; the file is unchanged`);
        continue;
      }
      try {
        await writeFormatted(file, change.before, change.after);
        written.push(change.file);
      } catch (error) {
        const failure = replacementFailure(error);
        if (!failure) throw error;
        refuse(change.file, failure);
      }
    }
  // As in ESLint, --quiet leaves warnings out of the report and of what counts them.
  if (flags.quiet)
    for (const report of reports)
      report.diagnostics = report.diagnostics.filter((item) => item.severity !== "warn");
  const diagnostics = reports.flatMap((report) => report.diagnostics);
  const count = (severity: Diagnostic["severity"]) =>
    diagnostics.filter((item) => item.severity === severity).length;
  if (flags.json)
    process.stdout.write(
      JSON.stringify(
        {
          version: manifest.version,
          mode,
          // The files' paths are relative to it, for programs to join.
          root,
          files: reports,
          written,
          ...(discovery.skipped.length ? { skipped: discovery.skipped } : {}),
        },
        null,
        2,
      ) + "\n",
    );
  else {
    // Text names documents from the current directory, as Prettier does, so
    // that a terminal or an editor opens them from where the command ran.
    const here = await realpath(process.cwd()).catch(() => process.cwd());
    const shown = (name: string) =>
      path.relative(here, path.join(discovery.root, name)).split(path.sep).join("/");
    // Warnings about the run, not about a document: they do not change the exit status.
    for (const item of discovery.skipped)
      process.stderr.write(`mdtools: warning: ${skippedMessage(item, shown)}\n`);
    if (stdin && mode === "format" && !flags.check && !flags.diff)
      process.stdout.write(reports[0]?.output ?? "");
    else if (mode === "format" && !flags.check && !flags.write)
      for (const change of changes)
        process.stdout.write(
          createTwoFilesPatch(
            `a/${shown(change.file)}`,
            `b/${shown(change.file)}`,
            change.before,
            change.after,
          ),
        );
    for (const report of reports)
      for (const item of report.diagnostics)
        process.stderr.write(
          `${shown(report.path)}:${item.line}:${item.column}: ${item.severity} ${item.rule}: ${item.message}\n`,
        );
    // The files to fix when a check fails, as Prettier's --check lists them.
    if (mode === "format" && flags.check && !stdin)
      for (const change of changes) process.stderr.write(`${shown(change.file)}\n`);
    if (!stdin) {
      // Lint changes nothing, so its summary counts what it reported instead.
      const outcome =
        mode === "lint"
          ? `${count("error")} error(s), ${count("warn")} warning(s)`
          : flags.write
            ? `${written.length} written`
            : `${changes.length} would change`;
      process.stderr.write(
        `${discovery.selected.length - unread.length} file(s) ${mode === "lint" ? "linted" : "processed"}; ${outcome}${unread.length ? `; ${unread.length} could not be read` : ""}${unwritten.length ? `; ${unwritten.length} could not be written` : ""}.\n`,
      );
    }
  }
  const errors = count("error") > 0;
  const tooManyWarnings = flags.maxWarnings !== undefined && count("warn") > flags.maxWarnings;
  process.exitCode =
    failed || unwritten.length > 0
      ? 2
      : errors || tooManyWarnings || (flags.check && changes.length > 0)
        ? 1
        : 0;
}
common(
  program
    .command("lint")
    .argument("[paths...]", "Files, directories, or glob patterns to select, or - for stdin"),
)
  .description("Report the findings of the enabled rules; never writes")
  .action((inputs: string[], flags: Flags) => run("lint", inputs, flags));
common(
  program
    .command("format")
    .argument("[paths...]", "Files, directories, or glob patterns to select, or - for stdin"),
)
  .description("Format documents: print a diff (the default), check, or write")
  .option("--check", "Fail if formatting changes would be needed, and name the files")
  .option("--diff", "Preview the complete diff (default for file inputs)")
  .option("--write", "Write validated formatting changes")
  .action((inputs: string[], flags: Flags) => run("format", inputs, flags));
// The options belong to `config`, which reads them before or after `explain`;
// `explain` repeats them so that its help lists them.
workspaceOptions(
  workspaceOptions(program.command("config").description("Inspect the configuration"))
    .command("explain")
    .description("Print, as JSON, the configuration in effect for one document")
    .argument("<file>", "The document, which need not exist"),
).action(async (file: string, _flags: unknown, command: Command) => {
  const flags = command.optsWithGlobals<Flags>();
  const { root, config, plugins, file: source } = await workspace(flags);
  const name = await workspacePath(root, file);
  if (name === undefined) throw new Error(`Input is outside the workspace: ${file}`);
  // The search for the document's vault starts from the root's real path too.
  const actual = await realpath(root).catch(() => root);
  process.stdout.write(
    JSON.stringify(
      {
        root,
        config: source ?? null,
        path: name,
        effective: resolveConfig(
          config,
          name,
          plugins,
          assumedDialect(await enclosingVault(path.join(actual, name))),
        ),
      },
      null,
      2,
    ) + "\n",
  );
});
program
  .command("rules")
  .description("List the built-in rules and those of the configuration's plugins")
  .option(...configOption)
  .option("--json", "Print the list as JSON")
  .action(async (flags: Flags) => {
    const { plugins } = await loadConfig(path.resolve("."), flags.config);
    const rules = Object.entries(ruleRegistry(plugins)).map(([id, rule]) => ({
      id,
      kind: rule.kind,
      description: rule.description,
    }));
    if (flags.json) process.stdout.write(JSON.stringify({ rules }, null, 2) + "\n");
    else
      for (const rule of rules)
        // One line per rule, even when a plugin's description has line breaks or tabs.
        process.stdout.write(
          `${rule.id}\t${rule.kind}\t${rule.description.replace(/\s+/g, " ")}\n`,
        );
  });
try {
  await program.parseAsync();
} catch (error) {
  // Commander has printed the help, the version, or what is wrong with the
  // command line. Help and the version succeed; a usage error ends with code 2,
  // as in ESLint and Prettier, so that it does not pass for findings.
  if (error instanceof CommanderError) process.exitCode = error.exitCode === 0 ? 0 : 2;
  else {
    process.stderr.write(`mdtools: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
