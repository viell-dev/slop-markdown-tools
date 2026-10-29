#!/usr/bin/env node
import { Command, CommanderError, InvalidArgumentError, Option } from "commander";
import { readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lint, ruleRegistry } from "../core/engine.js";
import { formatWithCode } from "../code/format.js";
import { loadCompetitorConfig } from "../config/competitors.js";
import { loadConfig, searchConfig, configFiles } from "../config/load.js";
import { dialectAliases, dialects, resolveConfig } from "../config/resolve.js";
import { isIgnoredInput, skippedMessage } from "../workspace/files.js";
import { replacementFailure, replacementProblem, writeFormatted } from "../workspace/writes.js";
import { assumedDialect, checkRoot, discoverFrom } from "../workspace/discovery.js";
import { enclosingVault } from "../workspace/vault.js";
import { exists, refusal, refusalText } from "../workspace/access.js";
import { decodeText, NotUtf8Error } from "../workspace/encoding.js";
import { unifiedDiff } from "./diff.js";
import type { Diagnostic, DialectName } from "../core/types.js";

interface Flags {
  competitorConfig?: boolean;
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
  /** False with `--no-warn-ignored`. */
  warnIgnored?: boolean;
  fix?: boolean;
}
const manifest = JSON.parse(
  await readFile(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
) as { version: string };
// Subcommands inherit these settings, so they come before the commands.
const program = new Command()
  .name("mdrefine")
  .description("Lint and format Markdown with explicit dialects and configurable rules.")
  .version(manifest.version, "-V, --version", "Print the version")
  .helpOption("-h, --help", "Print help for the command")
  .helpCommand("help [command]", "Print help for a command")
  .configureHelp({ helpWidth: 80 })
  // Commander starts its messages with "error: ", the tool with its name.
  .configureOutput({
    outputError: (text, write) => write(`mdrefine: ${text.replace(/^error: /, "")}`),
  })
  // Throw instead of exiting, so that a usage error can end with code 2.
  .exitOverride();
const configOption = [
  "--config <file>",
  "Use this JSON, JSONC, or JavaScript configuration file instead of searching for one",
] as const;
const competitorOption = [
  "--no-competitor-config",
  "Do not fall back to markdownlint and Prettier configurations when no mdrefine configuration is found",
] as const;
/** The dialects, each with its other names, as in "forgejo (alias: codeberg)". */
const dialectList = dialects
  .map((dialect) => {
    const aliases = Object.entries(dialectAliases).flatMap(([name, of]) =>
      of === dialect ? [name] : [],
    );
    return aliases.length ? `${dialect} (alias: ${aliases.join(", ")})` : dialect;
  })
  .join(", ");
/** The options that choose the configuration, the workspace, and the dialect. */
function workspaceOptions(command: Command): Command {
  return command
    .option(...configOption)
    .option(...competitorOption)
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
      .option(
        "--no-warn-ignored",
        "Do not warn about named files and directories that are skipped as ignored",
      )
      .option(
        "--stdin-filepath <file>",
        "Read stdin as this file, for its configuration and reports",
      )
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
  const loaded = await loadConfig(
    path.resolve(flags.root ?? "."),
    flags.config,
    flags.competitorConfig,
  );
  if (loaded.conversion) {
    process.stderr.write(
      `mdrefine: using competitor configuration: ${loaded.conversion.sources.join(", ")}\n`,
    );
    for (const message of [...loaded.conversion.omitted, ...loaded.conversion.conflicts])
      process.stderr.write(`mdrefine: ${message}\n`);
  }
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
const failures = new Set(["engine/unsafe-format", "engine/rule-error", "engine/code-formatter"]);
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
        ? "unknown option '--fix': lint never changes files; 'mdrefine format --write' applies the fixes."
        : "unknown option '--fix': format writes its changes with --write.",
    );
  if (mode === "lint" && (flags.write || flags.check))
    throw new Error(
      `lint never changes files; use 'mdrefine format --${flags.write ? "write" : "check"}' instead.`,
    );
  if (flags.write && (flags.check || flags.diff))
    throw new Error("--write cannot be combined with --check or --diff.");
  if (flags.stdinFilepath !== undefined) {
    if (inputs.some((input) => input !== "-"))
      throw new Error("Use --stdin-filepath with no paths or with - to read stdin.");
    if (inputs.length === 0) inputs = ["-"];
  }
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
  // path selects the whole workspace; stdin is the only document then. Ignore
  // rules apply to the path that `--stdin-filepath` names, as to a named file,
  // and not to the default name.
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
    flags.stdinFilepath !== undefined,
  );
  // Skipped inputs and stdin already say what happened, and JSON reports an empty
  // file list; the notice explains only a selection that silently came up empty.
  if (
    discovery.selected.length === 0 &&
    discovery.skipped.length === 0 &&
    !flags.json &&
    !inputs.includes("-")
  )
    process.stderr.write("mdrefine: No documents selected.\n");
  const compatibilityWarnings = new Set<string>();
  const reports: Report[] = [];
  const changes: { file: string; before: string; after: string }[] = [];
  // Selected files that the system refused to let the tool read, or that are not UTF-8 text.
  const unread: string[] = [];
  for (const name of discovery.selected) {
    const options = {
      ...discovery.options(name),
      compatibility: loaded.compatibility,
      onCompatibilityWarning: (message: string) => {
        if (!compatibilityWarnings.has(message)) {
          compatibilityWarnings.add(message);
          process.stderr.write(`mdrefine: ${message}\n`);
        }
      },
    };
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
      const result = await formatWithCode(source, { ...options, cwd: discovery.root });
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
    // A caller that passes every changed file can leave out those about ignored ones.
    for (const item of discovery.skipped)
      if (flags.warnIgnored !== false || !isIgnoredInput(item))
        process.stderr.write(`mdrefine: warning: ${skippedMessage(item, shown)}\n`);
    // An ignored document from stdin comes back unchanged, as in Prettier, so
    // that an editor that replaces its text with the output loses nothing.
    if (stdin && mode === "format" && !flags.check && !flags.diff)
      process.stdout.write(reports[0]?.output ?? Object.values(documents ?? {})[0] ?? "");
    else if (mode === "format" && (!flags.check || flags.diff) && !flags.write)
      for (const change of changes)
        process.stdout.write(
          unifiedDiff(
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
    if (mode === "format" && flags.check && !flags.diff && !stdin)
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
  if (mode === "format" && !flags.write && (!flags.check || flags.diff) && !stdin && !flags.json)
    process.stderr.write("Use --write to apply formatting changes.\n");
  const errors = count("error") > 0;
  const tooManyWarnings = flags.maxWarnings !== undefined && count("warn") > flags.maxWarnings;
  process.exitCode =
    failed || unwritten.length > 0
      ? 2
      : errors ||
          tooManyWarnings ||
          ((flags.check || (mode === "format" && !stdin && !flags.write && !flags.diff)) &&
            changes.length > 0)
        ? 1
        : 0;
}
common(
  program
    .command("lint")
    .argument("[paths...]", "Files, directories, or glob patterns to select, or - for stdin"),
)
  .description("Report the findings of the enabled rules; never writes")
  .addOption(new Option("--write").hideHelp())
  .addOption(new Option("--check").hideHelp())
  .action((inputs: string[], flags: Flags) => run("lint", inputs, flags));
common(
  program
    .command("format")
    .argument("[paths...]", "Files, directories, or glob patterns to select, or - for stdin"),
)
  .description("Format documents: check with a diff (default), list changes, or write")
  .option("--check", "Fail if formatting changes would be needed, and name the files")
  .option("--diff", "Preview the diff; changes alone exit 0 (with --check, exit 1)")
  .option("--write", "Write validated formatting changes")
  .action((inputs: string[], flags: Flags) => run("format", inputs, flags));
// The options belong to `config`, which reads them before or after `explain`;
// `explain` repeats them so that its help lists them.
const configCommand = workspaceOptions(
  program.command("config").description("Inspect or convert the configuration"),
);
workspaceOptions(
  configCommand
    .command("explain")
    .description("Print, as JSON, the configuration in effect for one document")
    .argument("<file>", "The document, which need not exist"),
).action(async (file: string, _flags: unknown, command: Command) => {
  const flags = command.optsWithGlobals<Flags>();
  const { root, config, plugins, conversion, file: source } = await workspace(flags);
  const name = await workspacePath(root, file);
  if (name === undefined) throw new Error(`Input is outside the workspace: ${file}`);
  // The search for the document's vault starts from the root's real path too.
  const actual = await realpath(root).catch(() => root);
  process.stdout.write(
    JSON.stringify(
      {
        root,
        config: source ?? null,
        ...(conversion ? { conversion } : {}),
        path: name,
        effective: resolveConfig({
          config,
          path: name,
          plugins,
          defaultDialect: assumedDialect(await enclosingVault(path.join(actual, name))),
        }),
      },
      null,
      2,
    ) + "\n",
  );
});
configCommand
  .command("convert")
  .description("Convert markdownlint and Prettier configurations to mdrefine.config.jsonc")
  .option(
    "--root <directory>",
    "Directory to search from and to write to (default: the current directory)",
  )
  .option("--write", "Create mdrefine.config.jsonc; refuse any existing mdrefine configuration")
  .action(async (_flags: unknown, command: Command) => {
    const flags = command.optsWithGlobals<Flags>();
    const root = path.resolve(flags.root ?? ".");
    const { directories } = await searchConfig(root);
    if (flags.write)
      for (const name of configFiles)
        if (await exists(path.join(root, name)))
          throw new Error(`Existing mdrefine configuration: ${name}`);
    const report = await loadCompetitorConfig(directories, true, root);
    if (!report) throw new Error("No markdownlint or Prettier configuration found.");
    resolveConfig({ config: report.config });
    const text = JSON.stringify(report.config, null, 2) + "\n";
    if (flags.write)
      await writeFile(path.join(path.resolve(flags.root ?? "."), "mdrefine.config.jsonc"), text, {
        flag: "wx",
      });
    else process.stdout.write(text);
    for (const message of [
      ...report.sources,
      ...report.omitted,
      ...report.conflicts,
      ...report.suggestions,
    ])
      process.stderr.write(`mdrefine: ${message}\n`);
    process.stderr.write(
      "mdrefine: competitor inline comments and pragmas apply during fallback only, are not converted, and have no effect with an mdrefine configuration; use mdrefine-disable comments instead.\n",
    );
  });
program
  .command("rules")
  .description("List the built-in rules and those of the configuration's plugins")
  .option(...configOption)
  .option(...competitorOption)
  .option("--root <directory>", "Directory to search for configuration")
  .option("--json", "Print the list as JSON")
  .action(async (flags: Flags) => {
    if (flags.root !== undefined) await checkRoot(flags.root);
    const loaded = await loadConfig(
      path.resolve(flags.root ?? "."),
      flags.config,
      flags.competitorConfig,
    );
    const { plugins } = loaded;
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
// Keep the selection scope, exit codes and short examples available without
// opening the docs. Each footer stays within 80 columns.
const selection = `Without paths, the whole workspace is selected, including documents outside the
current directory. Read stdin with - or with --stdin-filepath <file> alone.`;
const footers: Record<string, string> = {
  "": `
Start with mdrefine lint and mdrefine format; mdrefine help <command> describes
each command. Configuration: mdrefine config explain <file> and config convert.`,
  lint: `
${selection}

Exit codes: 0 no errors; 1 errors, or more warnings than --max-warnings;
2 usage, configuration or run failure.

Examples:
  mdrefine lint                      Report the findings in every document
  mdrefine lint docs README.md       Only these paths
  mdrefine lint --max-warnings 0     Also fail on warnings`,
  format: `
${selection}
Stdin prints the formatted document unless --check or --diff is given.
--json reports the results without the diff. Formatting also reports problem
rules; errors that remain exit 1.

Exit codes: 0 nothing to change, or the changes were written, previewed with
--diff, or printed from stdin; 1 changes needed, errors remain, or more
warnings than --max-warnings; 2 usage, configuration or run failure.

Examples:
  mdrefine format                    Check every document and show the diff
  mdrefine format --write            Apply the changes
  mdrefine format --check            List the documents that would change
  mdrefine format --stdin-filepath a.md  Format stdin as a.md`,
  rules: `
Exit codes: 0 success; 2 usage or configuration failure.

Examples:
  mdrefine rules                     List the rules
  mdrefine rules --json              The same list as JSON`,
  config: `
Exit codes: 0 success; 2 usage or configuration failure.

Examples:
  mdrefine config explain notes/a.md  Show one document's configuration
  mdrefine config convert --write     Convert other tools' settings`,
  explain: `
Exit codes: 0 success; 2 usage or configuration failure.

Example:
  mdrefine config explain notes/a.md`,
  convert: `
Exit codes: 0 success; 2 usage or configuration failure, or nothing to convert.

Examples:
  mdrefine config convert            Print the converted configuration
  mdrefine config convert --write    Create the configuration file`,
};
program.addHelpText("after", footers[""]!);
for (const command of [...program.commands, ...configCommand.commands]) {
  const footer = footers[command.name()];
  if (footer) command.addHelpText("after", footer);
}
try {
  const args = process.argv.slice(2);
  if (args[0] === "check" || args[0] === "fix")
    throw new Error(
      `Unknown command '${args[0]}'; use 'mdrefine format --${args[0] === "check" ? "check" : "write"}' instead.`,
    );
  // Commander routes only one level of its implicit help command.
  if (args[0] === "help" && args.length > 2) {
    let command = program;
    for (const name of args.slice(1)) {
      const child = command.commands.find((child) => child.name() === name);
      if (!child) throw new Error(`Unknown help command: ${args.slice(1).join(" ")}`);
      command = child;
    }
    command.help();
  } else await program.parseAsync();
} catch (error) {
  // Commander has printed the help, the version, or what is wrong with the
  // command line. Help and the version succeed; a usage error ends with code 2,
  // as in ESLint and Prettier, so that it does not pass for findings.
  if (error instanceof CommanderError) process.exitCode = error.exitCode === 0 ? 0 : 2;
  else {
    process.stderr.write(`mdrefine: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 2;
  }
}
