import { spawnSync } from "node:child_process";
import process from "node:process";
import { expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({ chmodSync: vi.fn(), mkdirSync: vi.fn(), rmSync: vi.fn() }));
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return { ...actual, spawnSync: vi.fn() };
});

it("passes a Windows-sized PROBE batch through the runner without putting it in arguments", async () => {
  const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
  const probe = JSON.stringify([`${"a".repeat(40000)}\nquotes: "; Unicode: café 🌍`]);
  const exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  vi.stubEnv("PROBE", probe);
  vi.stubEnv("SEED", "123");
  vi.stubEnv("COUNT", "0");
  vi.stubEnv("REDUCE", "");
  vi.stubEnv("OBSIDIAN_VERSION", "");
  let received: string | undefined;
  vi.mocked(spawnSync).mockImplementation((command, parameters) => {
    expect(command).toBe("docker");
    if (parameters?.[0] === "build")
      return { pid: 0, output: [], stdout: "", stderr: "", status: 0, signal: null };
    // Stand in for Docker with a real child process: argument-size limits still apply,
    // while no daemon, image, application, or changes to artifacts/ are needed.
    const result = actual.spawnSync(
      process.execPath,
      [
        "-e",
        `const values = {};
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] !== "--env") continue;
  const name = process.argv[++i];
  values[name] = process.env[name];
}
process.stdout.write(JSON.stringify(values));`,
        "--",
        ...(parameters ?? []),
      ],
      { encoding: "utf8" },
    );
    expect(result.error?.message).toBeUndefined();
    received = result.stdout;
    return result;
  });
  try {
    await import("../../scripts/obsidian-check.mjs");
    expect(JSON.parse(received!)).toEqual({ PROBE: probe, SEED: "123", COUNT: "0" });
    expect(exit).toHaveBeenCalledExactlyOnceWith(0);
  } finally {
    exit.mockRestore();
    vi.unstubAllEnvs();
    vi.mocked(spawnSync).mockReset();
  }
});
