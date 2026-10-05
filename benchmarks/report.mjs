// Render the measurements of run.mjs as the Markdown report shown in docs/benchmarks.md.

const seconds = (ms) =>
  ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${ms.toFixed(ms < 10 ? 1 : 0)} ms`;
const megabytes = (bytes) => `${(bytes / 1e6).toFixed(bytes < 1e7 ? 2 : 1)} MB`;
const count = (value) => value.toLocaleString("en-US");
const range = (ms) => `${seconds(ms.min)} to ${seconds(ms.max)}`;
const runs = (samples) => `${samples} ${samples === 1 ? "run" : "runs"}`;
const perFile = (result) => `${(result.ms.median / result.files).toFixed(2)} ms`;
const perSecond = (result) => megabytes((result.bytes / result.ms.median) * 1000);
const table = (header, rows) =>
  [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
    "",
  ].join("\n");

export function markdown(report) {
  const find = (id) => report.results.find((result) => result.id === id);
  const group = (name) => report.results.filter((result) => result.group === name);
  const libraryTable = (name) => {
    const rows = group(name);
    const parseMs = find(`${name}.parse`).ms.median;
    return (
      `${count(rows[0].files)} files, ${megabytes(rows[0].bytes)}.\n\n` +
      table(
        [
          "Step",
          "Time",
          "Fastest to slowest run",
          "Per file",
          "Per second",
          "Compared with parsing",
        ],
        rows.map((result) => [
          result.label,
          seconds(result.ms.median),
          range(result.ms),
          perFile(result),
          perSecond(result),
          `${(result.ms.median / parseMs).toFixed(1)}×`,
        ]),
      )
    );
  };
  return [
    `# ${report.package} benchmark${report.quick ? " (quick run, not a measurement)" : ""}`,
    "",
    `- ${report.node} on ${report.platform}; ${report.cpu}.`,
    `- Each time is the median of ${runs(report.samples)} after one warm-up run.`,
    `- Prettier ${report.prettier} is the comparison formatter.`,
    `- Output hash: \`${report.outputHash.slice(0, 16)}\`.`,
    "",
    "## Library: repository documentation",
    "",
    libraryTable("repository"),
    "## Library: Obsidian vault",
    "",
    libraryTable("vault"),
    "## Command line",
    "",
    `The repository documentation above, as ${count(find("cli.lint").files)} files on disk.\n`,
    table(
      ["Command", "Time", "Fastest to slowest run", "Peak memory"],
      group("cli").map((result) => [
        result.label,
        seconds(result.ms.median),
        range(result.ms),
        result.peakMemoryBytes ? megabytes(result.peakMemoryBytes) : "",
      ]),
    ),
    "## More files",
    "",
    ...group("files")
      .filter((result) => result.samples && result.id.endsWith("-lint"))
      .slice(0, 1)
      .map(
        (result) =>
          `The middle row repeats the measurements above. The times in the other rows are the median of ${runs(result.samples)} without a warm-up run.\n`,
      ),
    table(
      [
        "Files",
        "Size",
        "Lint",
        "Lint per file",
        "Format with changes",
        "Format per file",
        "Peak memory of a command-line lint",
      ],
      group("files")
        .filter((result) => result.id.endsWith("-lint"))
        .map((linted) => {
          const formatted = find(linted.id.replace(/lint$/, "format-changes"));
          return [
            count(linted.files),
            megabytes(linted.bytes),
            seconds(linted.ms.median),
            perFile(linted),
            seconds(formatted.ms.median),
            perFile(formatted),
            megabytes(linted.peakMemoryBytes),
          ];
        }),
    ),
    "## Larger documents",
    "",
    table(
      ["Document size", "Format with changes", "Per kilobyte"],
      group("document").map((result) => [
        `${count(Math.round(result.bytes / 1000))} kB`,
        seconds(result.ms.median),
        `${(result.ms.median / (result.bytes / 1000)).toFixed(2)} ms`,
      ]),
    ),
  ].join("\n");
}
