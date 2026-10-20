import { spawnSync } from "node:child_process";
import path from "node:path";
import { expect, it } from "vitest";
import { canRestrict, repository } from "./support.js";

function check(scenario: string) {
  const result = spawnSync(
    process.execPath,
    [path.join(repository, "tests/fixtures/skipped-path-case/run.mjs"), scenario],
    { encoding: "utf8", timeout: 20_000 },
  );
  expect(result.error?.message).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ scenario, ok: true });
}

it.each(["basic", "security"])("checks %s skipped-folder paths through the host API (#459)", check);
it.skipIf(process.platform !== "linux")("reports ambiguous case variants on Linux", () =>
  check("ambiguous"),
);
it.skipIf(!canRestrict)("reports an unreadable folded directory", () => check("unreadable"));
