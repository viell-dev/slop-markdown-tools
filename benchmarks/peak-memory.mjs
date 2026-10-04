// Preloaded into a CLI process by run.mjs to record that process's peak memory.
import process from "node:process";
import { writeFileSync } from "node:fs";

process.on("exit", () => {
  // maxRSS is reported in kilobytes on every platform.
  writeFileSync(process.env.MDTOOLS_BENCHMARK_MEMORY, String(process.resourceUsage().maxRSS));
});
