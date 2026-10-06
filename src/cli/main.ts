#!/usr/bin/env node
import { Command } from "commander";
import { createTwoFilesPatch } from "diff";
import { access, constants, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format, lint, ruleRegistry } from "../core/engine.js";
import { loadConfig } from "../config/load.js";
import { resolveConfig } from "../config/resolve.js";
import { discover, vaultFor, writeAtomic } from "../workspace/files.js";
import { enclosingVault, vaultOf } from "../workspace/vault.js";
import { excludeSelection } from "../workspace/selection.js";
import { createWorkspace } from "../workspace/index.js";
import { pathError, refusal, refusalText } from "../workspace/access.js";
import type { Diagnostic, Dialect, DialectName, ProcessOptions, Workspace } from "../core/types.js";
import type { Vault } from "../workspace/vault.js";

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
}
const manifest = JSON.parse(
  await readFile(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8"),
) as { version: string };
const program = new Command()
  .name("mdtools")
  .description("Lint and format Markdown with explicit dialects and configurable rules.")
  .version(manifest.version);
function common(command: Command): Command {
  return command
    .option("--config <file>", "Explicit JSON, JSONC, or .mjs configuration")
    .option("--root <directory>", "Workspace root (default: configuration directory or cwd)")
    .option(
      "--dialect <dialect>",
      "commonmark, github, forgejo (alias: codeberg), gitea, or obsidian (when none is named: github, or obsidian inside a vault)",
    )
    .option(
      "--exclude <path>",
      "Exclude an exact file or directory (repeatable)",
      (value: string, previous: string[]) => [...previous, value],
      [],
    )
    .option("--json", "Machine-readable output")
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
    );
}
interface Report {
  path: string;
  changed?: boolean;
  diagnostics: Diagnostic[];
  output?: string;
}
/**
 * The dialect to assume for a document when nothing names one, or undefined for
 * the library's own default. An Obsidian vault shows a single line break as a
 * line break and holds wikilinks, both of which any other dialect lets reflow
 * change, so a document that a vault holds is read as a note.
 */
function assumedDialect(vault: Vault | string | undefined): Dialect | undefined {
  return vault ? "obsidian" : undefined;
}
/**
 * Stops when the folder given as `--root` cannot serve as a workspace root.
 * Without this check the first thing to fail would be the search for a
 * configuration file in it, with a message about a file the user never named.
 */
async function checkRoot(given: string | undefined): Promise<void> {
  if (given === undefined) return;
  const root = path.resolve(given);
  try {
    if (!(await stat(root)).isDirectory())
      throw new Error(`Workspace root is not a directory: ${root}`);
    await access(root, constants.R_OK | constants.X_OK);
  } catch (error) {
    throw pathError("Workspace root", root, error);
  }
}
async function run(mode: "lint" | "format", inputs: string[], flags: Flags) {
  if ([flags.check, flags.diff, flags.write].filter(Boolean).length > 1)
    throw new Error("Choose only one of --check, --diff, and --write.");
  if (inputs.includes("-") && flags.exclude?.length)
    throw new Error("--exclude cannot be combined with stdin.");
  await checkRoot(flags.root);
  const loaded = await loadConfig(path.resolve(flags.root ?? "."), flags.config);
  const root = path.resolve(flags.root ?? loaded.root);
  if (flags.dialect) loaded.config.dialect = flags.dialect;
  // Which files to leave out does not depend on a document's dialect.
  const resolved = resolveConfig(loaded.config, "document.md", loaded.plugins);
  const stdin = inputs.includes("-");
  if (stdin && (inputs.length !== 1 || flags.write))
    throw new Error("stdin must be the only input and cannot be combined with --write.");
  const set = await discover(root, stdin ? [] : inputs, resolved.ignore, resolved.resolve);
  set.selected = await excludeSelection(set.root, set.selected, flags.exclude ?? []);
  /** The vault of the document read from stdin, found by a search of its own. */
  let named: Vault | undefined;
  if (stdin) {
    const name = path
      .relative(root, path.resolve(flags.stdinFilepath ?? path.join(root, "stdin.md")))
      .split(path.sep)
      .join("/");
    if (name.startsWith("../") || path.isAbsolute(name))
      throw new Error("--stdin-filepath must be within the workspace.");
    let source = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) source += String(chunk);
    set.files[name] = source;
    set.selected = [name];
    // The name can lead into a folder that discovery did not visit.
    named = await vaultFor(set, name);
  }
  // Links into a directory that could not be read are reported as unchecked, not as missing.
  const unreadable = set.skipped.flatMap((item) => (item.type === "directory" ? [item.path] : []));
  const reports: Report[] = [];
  const changes: { file: string; before: string; after: string }[] = [];
  // Selected files that the system refused to let the tool read.
  const unread: string[] = [];
  // One index per active dialect; build lazily for mixed documentation workspaces.
  const indexes = new Map<Dialect, Workspace>();
  // The same index with the line-break setting of each vault that has documents in it.
  const views = new Map<Dialect, Map<Vault, Workspace>>();
  for (const name of set.selected) {
    const vault = stdin ? named : vaultOf(set.vaults, name);
    const assumed = assumedDialect(vault);
    const config = resolveConfig(loaded.config, name, loaded.plugins, assumed);
    let workspace = indexes.get(config.dialect);
    if (!workspace)
      indexes.set(
        config.dialect,
        (workspace = createWorkspace(set.files, {
          dialect: config.dialect,
          directories: set.directories,
          unreadable,
        })),
      );
    // Whether a note may be reflowed is a setting of its own vault.
    if (vault?.strictLineBreaks !== undefined) {
      let ofDialect = views.get(config.dialect);
      if (!ofDialect) views.set(config.dialect, (ofDialect = new Map()));
      const index = workspace;
      workspace = ofDialect.get(vault);
      if (!workspace)
        ofDialect.set(vault, (workspace = { ...index, strictLineBreaks: vault.strictLineBreaks }));
    }
    const options: ProcessOptions = {
      path: name,
      config: loaded.config,
      plugins: loaded.plugins,
      workspace,
      ...(assumed ? { defaultDialect: assumed } : {}),
    };
    const value = set.files[name]!;
    let source: string | null;
    try {
      source = typeof value === "function" ? value() : value;
    } catch (error) {
      // Report the file and carry on with the others; any other error is a fault.
      const code = refusal(error);
      if (!code) throw error;
      unread.push(name);
      reports.push({
        path: name,
        ...(mode === "format" ? { changed: false } : {}),
        diagnostics: [
          {
            start: 0,
            message: `The file could not be read (${refusalText(code)}) and was not ${mode === "lint" ? "linted" : "formatted"}.`,
            rule: "engine/unreadable-file",
            severity: "error",
            line: 1,
            column: 1,
          },
        ],
      });
      continue;
    }
    if (source === null) continue;
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
  // A file that could not be formatted safely, or not be read at all, is a failure
  // to operate: nothing of the batch is written, and the run ends with status 2.
  const diagnostics = reports.flatMap((report) => report.diagnostics);
  const count = (severity: Diagnostic["severity"]) =>
    diagnostics.filter((item) => item.severity === severity).length;
  const unsafe =
    unread.length > 0 ||
    reports.some((report) =>
      report.diagnostics.some((item) => item.rule === "engine/unsafe-format"),
    );
  if (flags.write && !unsafe)
    for (const change of changes)
      await writeAtomic(path.join(set.root, change.file), change.before, change.after);
  if (flags.json)
    process.stdout.write(
      JSON.stringify(
        {
          version: manifest.version,
          mode,
          files: reports,
          written: flags.write === true && !unsafe,
          ...(set.skipped.length ? { skipped: set.skipped } : {}),
        },
        null,
        2,
      ) + "\n",
    );
  else {
    // Warnings about the run, not about a document: they do not change the exit status.
    for (const item of set.skipped) process.stderr.write(`mdtools: warning: ${item.message}\n`);
    if (stdin && mode === "format" && !flags.check && !flags.diff)
      process.stdout.write(reports[0]?.output ?? "");
    else if (mode === "format" && !flags.check && !flags.write)
      for (const change of changes)
        process.stdout.write(
          createTwoFilesPatch(`a/${change.file}`, `b/${change.file}`, change.before, change.after),
        );
    for (const report of reports)
      for (const item of report.diagnostics)
        process.stderr.write(
          `${report.path}:${item.line}:${item.column}: ${item.severity} ${item.rule}: ${item.message}\n`,
        );
    if (!stdin) {
      // Lint changes nothing, so its summary counts what it reported instead.
      const outcome =
        mode === "lint"
          ? `${count("error")} error(s), ${count("warn")} warning(s)`
          : `${changes.length} ${flags.write && !unsafe ? "written" : "would change"}`;
      process.stderr.write(
        `${set.selected.length - unread.length} file(s) ${mode === "lint" ? "linted" : "processed"}; ${outcome}${unread.length ? `; ${unread.length} could not be read` : ""}.\n`,
      );
    }
  }
  const errors = count("error") > 0;
  const tooManyWarnings = flags.maxWarnings !== undefined && count("warn") > flags.maxWarnings;
  process.exitCode = unsafe
    ? 2
    : errors || tooManyWarnings || (flags.check && changes.length > 0)
      ? 1
      : 0;
}
common(
  program.command("lint").argument("[paths...]", "Markdown files/directories, or - for stdin"),
).action((inputs: string[], flags: Flags) => run("lint", inputs, flags));
common(
  program.command("format").argument("[paths...]", "Markdown files/directories, or - for stdin"),
)
  .option("--check", "Fail if formatting changes would be needed")
  .option("--diff", "Preview the complete diff (default for file inputs)")
  .option("--write", "Write validated formatting changes")
  .action((inputs: string[], flags: Flags) => run("format", inputs, flags));
common(program.command("config").description("Inspect effective configuration"))
  .command("explain <file>")
  .action(async (file: string, _flags: unknown, command: Command) => {
    const flags = command.parent!.opts<Flags>();
    await checkRoot(flags.root);
    const loaded = await loadConfig(path.resolve(flags.root ?? "."), flags.config);
    if (flags.dialect) loaded.config.dialect = flags.dialect;
    const root = path.resolve(flags.root ?? loaded.root);
    const name = path.relative(root, path.resolve(file)).split(path.sep).join("/");
    // The file need not exist. It is located through the root's real path, as
    // discovery locates it, so that a root reached through a link is searched
    // upward from where it really is.
    const actual = await realpath(root).catch(() => root);
    process.stdout.write(
      JSON.stringify(
        {
          root,
          file: loaded.file ?? null,
          effective: resolveConfig(
            loaded.config,
            name,
            loaded.plugins,
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
  .description("List built-in rules")
  .action(() => {
    for (const [name, rule] of Object.entries(ruleRegistry()))
      process.stdout.write(`${name}\t${rule.kind}\t${rule.description}\n`);
  });
try {
  await program.parseAsync();
} catch (error) {
  process.stderr.write(`mdtools: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
