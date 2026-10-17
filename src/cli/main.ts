#!/usr/bin/env node
import { Command } from "commander";
import { createTwoFilesPatch } from "diff";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format, lint, ruleRegistry } from "../core/engine.js";
import { loadConfig } from "../config/load.js";
import { resolveConfig } from "../config/resolve.js";
import { replacementFailure, replacementProblem, writeAtomic } from "../workspace/files.js";
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
async function run(mode: "lint" | "format", inputs: string[], flags: Flags) {
  if ([flags.check, flags.diff, flags.write].filter(Boolean).length > 1)
    throw new Error("Choose only one of --check, --diff, and --write.");
  if (inputs.includes("-") && flags.exclude?.length)
    throw new Error("--exclude cannot be combined with stdin.");
  // Without this check the first thing to fail would be the search for a
  // configuration file in the root, with a message about a file the user never named.
  if (flags.root !== undefined) await checkRoot(flags.root);
  const loaded = await loadConfig(path.resolve(flags.root ?? "."), flags.config);
  const root = path.resolve(flags.root ?? loaded.root);
  if (flags.dialect) loaded.config.dialect = flags.dialect;
  const stdin = inputs.includes("-");
  if (stdin && (inputs.length !== 1 || flags.write))
    throw new Error("stdin must be the only input and cannot be combined with --write.");
  /** The text read from stdin, by the name it is given in the workspace. */
  let documents: Record<string, string> | undefined;
  if (stdin) {
    const name = path
      .relative(root, path.resolve(flags.stdinFilepath ?? path.join(root, "stdin.md")))
      .split(path.sep)
      .join("/");
    if (name.startsWith("../") || path.isAbsolute(name))
      throw new Error("--stdin-filepath must be within the workspace.");
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
  // A file that could not be formatted safely, not be read at all, or not be
  // written is a failure to operate: nothing of the batch is written, and the
  // run ends with status 2.
  let unsafe =
    unread.length > 0 ||
    reports.some((report) =>
      report.diagnostics.some((item) => item.rule === "engine/unsafe-format"),
    );
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
  if (flags.write && !unsafe) {
    // What can be seen before writing stops the whole batch, instead of being
    // found part-way through it.
    for (const change of changes) {
      const problem = await replacementProblem(path.join(discovery.root, change.file));
      if (problem) refuse(change.file, `${problem}; no file was written`);
    }
    unsafe = unwritten.length > 0;
  }
  let written = 0;
  if (flags.write && !unsafe)
    for (const change of changes) {
      // Each file is replaced on its own, so a failure leaves the others to be written.
      try {
        await writeAtomic(path.join(discovery.root, change.file), change.before, change.after);
        written++;
      } catch (error) {
        const failure = replacementFailure(error);
        if (!failure) throw error;
        refuse(change.file, failure);
      }
    }
  const diagnostics = reports.flatMap((report) => report.diagnostics);
  const count = (severity: Diagnostic["severity"]) =>
    diagnostics.filter((item) => item.severity === severity).length;
  if (flags.json)
    process.stdout.write(
      JSON.stringify(
        {
          version: manifest.version,
          mode,
          files: reports,
          written: flags.write === true && !unsafe,
          ...(discovery.skipped.length ? { skipped: discovery.skipped } : {}),
        },
        null,
        2,
      ) + "\n",
    );
  else {
    // Warnings about the run, not about a document: they do not change the exit status.
    for (const item of discovery.skipped)
      process.stderr.write(`mdtools: warning: ${item.message}\n`);
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
          : flags.write && !unsafe
            ? `${written} written`
            : `${changes.length} would change`;
      process.stderr.write(
        `${discovery.selected.length - unread.length} file(s) ${mode === "lint" ? "linted" : "processed"}; ${outcome}${unread.length ? `; ${unread.length} could not be read` : ""}${unwritten.length ? `; ${unwritten.length} could not be written` : ""}.\n`,
      );
    }
  }
  const errors = count("error") > 0;
  const tooManyWarnings = flags.maxWarnings !== undefined && count("warn") > flags.maxWarnings;
  process.exitCode =
    unsafe || unwritten.length > 0
      ? 2
      : errors || tooManyWarnings || (flags.check && changes.length > 0)
        ? 1
        : 0;
}
common(
  program
    .command("lint")
    .argument("[paths...]", "Files, directories, or glob patterns to select, or - for stdin"),
).action((inputs: string[], flags: Flags) => run("lint", inputs, flags));
common(
  program
    .command("format")
    .argument("[paths...]", "Files, directories, or glob patterns to select, or - for stdin"),
)
  .option("--check", "Fail if formatting changes would be needed")
  .option("--diff", "Preview the complete diff (default for file inputs)")
  .option("--write", "Write validated formatting changes")
  .action((inputs: string[], flags: Flags) => run("format", inputs, flags));
common(program.command("config").description("Inspect effective configuration"))
  .command("explain <file>")
  .action(async (file: string, _flags: unknown, command: Command) => {
    const flags = command.parent!.opts<Flags>();
    if (flags.root !== undefined) await checkRoot(flags.root);
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
