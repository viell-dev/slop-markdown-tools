#!/usr/bin/env node
import { Command } from "commander";
import { createTwoFilesPatch } from "diff";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format, lint, ruleRegistry } from "../core/engine.js";
import { loadConfig } from "../config/load.js";
import { resolveConfig } from "../config/resolve.js";
import { discover, writeAtomic } from "../workspace/files.js";
import { excludeSelection } from "../workspace/selection.js";
import { createWorkspace } from "../workspace/index.js";
import type { Diagnostic, Dialect, ProcessOptions } from "../core/types.js";

interface Flags {
  config?: string;
  root?: string;
  dialect?: Dialect;
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
    .option("--dialect <dialect>", "commonmark, github, or obsidian")
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
  const loaded = await loadConfig(path.resolve(flags.root ?? "."), flags.config);
  const root = path.resolve(flags.root ?? loaded.root);
  if (flags.dialect) loaded.config.dialect = flags.dialect;
  const resolved = resolveConfig(loaded.config, "document.md", loaded.plugins);
  const stdin = inputs.includes("-");
  if (stdin && (inputs.length !== 1 || flags.write))
    throw new Error("stdin must be the only input and cannot be combined with --write.");
  const set = await discover(root, stdin ? [] : inputs, resolved.ignore, resolved.resolve);
  set.selected = await excludeSelection(set.root, set.selected, flags.exclude ?? []);
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
  }
  const reports: Report[] = [];
  const changes: { file: string; before: string; after: string }[] = [];
  // One index per active dialect; build lazily for mixed documentation workspaces.
  const indexes = new Map<Dialect, ReturnType<typeof createWorkspace>>();
  for (const name of set.selected) {
    const config = resolveConfig(loaded.config, name, loaded.plugins);
    if (!indexes.has(config.dialect))
      indexes.set(
        config.dialect,
        createWorkspace(set.files, {
          dialect: config.dialect,
          directories: set.directories,
          ...(set.strictLineBreaks !== undefined ? { strictLineBreaks: set.strictLineBreaks } : {}),
        }),
      );
    const options: ProcessOptions = {
      path: name,
      config: loaded.config,
      plugins: loaded.plugins,
      workspace: indexes.get(config.dialect)!,
    };
    const value = set.files[name]!;
    const source = typeof value === "function" ? value() : value;
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
  const unsafe = reports.some((report) =>
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
        },
        null,
        2,
      ) + "\n",
    );
  else {
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
    if (!stdin)
      process.stderr.write(
        `${set.selected.length} file(s) ${mode === "lint" ? "linted" : "processed"}; ${changes.length} ${flags.write && !unsafe ? "written" : "would change"}.\n`,
      );
  }
  const diagnostics = reports.flatMap((report) => report.diagnostics);
  const errors = diagnostics.some((item) => item.severity === "error");
  const tooManyWarnings =
    flags.maxWarnings !== undefined &&
    diagnostics.filter((item) => item.severity === "warn").length > flags.maxWarnings;
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
    const loaded = await loadConfig(path.resolve(flags.root ?? "."), flags.config);
    if (flags.dialect) loaded.config.dialect = flags.dialect;
    const root = path.resolve(flags.root ?? loaded.root);
    process.stdout.write(
      JSON.stringify(
        {
          root,
          file: loaded.file ?? null,
          effective: resolveConfig(
            loaded.config,
            path.relative(root, path.resolve(file)).split(path.sep).join("/"),
            loaded.plugins,
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
