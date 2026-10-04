import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { node, repository } from "./support.js";

interface Result {
  id: string;
  group: string;
  label: string;
  files?: number;
  bytes?: number;
  peakMemoryBytes?: number;
  ms: { median: number; min: number; max: number };
}
interface Report {
  quick: boolean;
  samples: number;
  outputHash: string;
  results: Result[];
}
const load = async <T>(file: string) =>
  (await import(pathToFileURL(path.join(repository, "benchmarks", file)).href)) as T;

// Timings are never asserted: this only keeps the suite and its documentation working.
describe("benchmark suite", () => {
  it("runs every measurement and renders the report documented in docs/benchmarks.md", async () => {
    const run = node("benchmarks/run.mjs", ["--quick", "--json"]);
    expect(run.status, run.stderr).toBe(0);
    const report = JSON.parse(run.stdout) as Report;
    expect(report).toMatchObject({ quick: true, samples: 1 });
    expect(report.outputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.results.map((result) => result.id)).toEqual([
      "repository.parse",
      "repository.lint",
      "repository.format-changes",
      "repository.format-clean",
      "repository.prettier",
      "vault.parse",
      "vault.lint",
      "vault.format-changes",
      "vault.format-clean",
      "cli.node",
      "cli.version",
      "cli.lint",
      "cli.lint-one",
      "cli.format-write",
      "cli.format-check",
      "files.6-lint",
      "files.6-format-changes",
      "files.12-lint",
      "files.12-format-changes",
      "files.24-lint",
      "files.24-format-changes",
      "document.4000-format-changes",
      "document.8000-format-changes",
      "document.16000-format-changes",
    ]);
    for (const result of report.results) {
      expect(result.ms.min, result.id).toBeGreaterThan(0);
      expect(result.ms.median, result.id).toBeGreaterThanOrEqual(result.ms.min);
      expect(result.ms.max, result.id).toBeGreaterThanOrEqual(result.ms.median);
      if (result.group === "cli") expect(result.peakMemoryBytes, result.id).toBeGreaterThan(1e6);
    }

    const { markdown } = await load<{ markdown(report: Report): string }>("report.mjs");
    const rendered = markdown(report);
    expect(rendered).toContain("(quick run, not a measurement)");
    // The page explains the report section by section and row by row; keep the two aligned.
    const page = await readFile(path.join(repository, "docs/benchmarks.md"), "utf8");
    for (const heading of rendered.match(/^## .+$/gm)!) expect(page).toContain(heading);
    // The scaling tables have one row per size; the others have one row per measurement.
    for (const result of report.results)
      if (!["files", "document"].includes(result.group))
        expect(page, result.id).toContain(`| ${result.label} `);
    for (const header of rendered.match(/^\| (?:Step|Command|Files|Document size) .+$/gm)!)
      expect(page.replaceAll(/ +\|/g, " |"), header).toContain(header);
    // Starting some twenty processes can take a while on a busy CI machine.
  }, 120_000);
  it("generates the same synthetic documents on every run", async () => {
    interface Corpus {
      files: Record<string, string>;
    }
    const corpus = await load<{
      repositoryDocs(count: number, seed?: number): Corpus;
      vault(count: number, seed?: number): Corpus;
      longDocument(bytes: number): string;
    }>("corpus.mjs");
    expect(corpus.repositoryDocs(5)).toEqual(corpus.repositoryDocs(5));
    expect(corpus.vault(5)).toEqual(corpus.vault(5));
    expect(corpus.repositoryDocs(5, 2).files).not.toEqual(corpus.repositoryDocs(5).files);
    expect(Object.keys(corpus.repositoryDocs(30).files)).toContain("docs/area-1/page-29.md");
    expect(corpus.longDocument(4000)).toBe(corpus.longDocument(4000));
    expect(corpus.longDocument(4000).length).toBeGreaterThanOrEqual(4000);
  });
});
