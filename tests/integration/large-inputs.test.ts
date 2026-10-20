import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, it } from "vitest";
import { repository } from "./support.js";

it.each(["table", "wrap", "inline-code", "findings", "ignore", "overrides", "lookup"])(
  "handles %s beyond the engine's function-argument limit (#454)",
  (scenario) => {
    // Each case has its own heap and starts after the unit tests, whose timing
    // checks should not compete with a table holding hundreds of thousands of nodes.
    const result = spawnSync(
      process.execPath,
      [
        "--max-old-space-size=4096",
        path.join(repository, "tests/fixtures/large-inputs/run.mjs"),
        scenario,
      ],
      { cwd: repository, encoding: "utf8", timeout: 150_000 },
    );
    expect(result.error?.message).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ scenario, ok: true });
  },
  180_000,
);
