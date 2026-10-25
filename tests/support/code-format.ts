import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CodeFormatter, Config } from "../../src/index.js";
import { fixture } from "./cli.js";

export const fence = "`".repeat(3);
const adapter = await readFile(new URL("../fixtures/code-formatter.mjs", import.meta.url), "utf8");
export const block = (value = "old", language = "js") =>
  `${fence}${language}\n${value}\n${fence}\n`;

export async function setup(mode = "constant") {
  const root = await fixture({ "adapter.mjs": adapter });
  const record = path.join(root, "calls.json");
  const tool = (extra: Partial<CodeFormatter> = {}): CodeFormatter => ({
    id: "javascript",
    languages: ["js"],
    command: process.execPath,
    args: [path.join(root, "adapter.mjs"), mode, "{filepath}", record],
    ...extra,
  });
  const config = (entries: readonly CodeFormatter[] = [tool()]): Config => ({
    extends: [],
    dialect: "github",
    codeFormatters: entries,
  });
  return { root, record, tool, config };
}

interface Call {
  source: string;
  filepath: string;
  cwd: string;
  label: string;
}
/** The log written only by the deterministic adapter fixture. */
export async function calls(record: string): Promise<Call[]> {
  return JSON.parse(await readFile(record, "utf8")) as Call[];
}
