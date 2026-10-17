import { tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Discovery applies the global excludes file of Git's settings, which differ
// between machines, so the integration tests run with none: no user or system
// settings, and a configuration folder with nothing in it.
const noGitSettings = path.join(tmpdir(), "mdtools-tests-no-git-settings");

export default defineConfig({
  test: {
    // The suites run one after the other. Integration tests start many processes, and
    // a few unit tests have time limits that such a load would make unreliable.
    projects: [
      {
        test: {
          name: "unit",
          include: ["tests/unit/**/*.test.ts"],
          testTimeout: 15000,
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          testTimeout: 30000,
          sequence: { groupOrder: 1 },
          env: {
            GIT_CONFIG_GLOBAL: path.join(noGitSettings, "gitconfig"),
            GIT_CONFIG_NOSYSTEM: "1",
            XDG_CONFIG_HOME: noGitSettings,
          },
        },
      },
    ],
  },
});
