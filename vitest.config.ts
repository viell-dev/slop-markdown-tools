import { availableParallelism, tmpdir } from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";
import type { ViteUserConfig } from "vitest/config";
import { buildParser } from "./scripts/build-parser.mjs";

// Discovery applies the global excludes file of Git's settings, which differ
// between machines, so the integration tests run with none: no user or system
// settings, and a configuration folder with nothing in it.
const noGitSettings = path.join(tmpdir(), "mdtools-tests-no-git-settings");

export default defineConfig(async (): Promise<ViteUserConfig> => {
  await buildParser({ repositoryRoot: import.meta.dirname });
  return {
    resolve: {
      alias: [
        {
          find: /^\.\/parser\.generated\.js$/,
          replacement: path.join(import.meta.dirname, "dist/syntax/parser.generated.js"),
        },
      ],
    },
    test: {
      coverage: {
        provider: "v8",
        include: ["src/**/*.ts"],
        reporter: ["text-summary", "html", "json-summary"],
        reportsDirectory: "coverage/unit",
      },
      // Keep complexity measurements apart from unit coverage and the integration
      // processes. Timing files run one at a time; integration concurrency is bounded.
      projects: [
        {
          test: {
            name: "unit",
            include: ["tests/unit/**/*.test.ts"],
            testTimeout: 15000,
            // CPU-heavy properties must not compete with one worker per core.
            maxWorkers: Math.min(4, availableParallelism()),
            sequence: { groupOrder: 0 },
          },
        },
        {
          test: {
            name: "performance",
            include: ["tests/performance/**/*.test.ts"],
            testTimeout: 60000,
            fileParallelism: false,
            sequence: { groupOrder: 1 },
          },
        },
        {
          test: {
            name: "integration",
            include: ["tests/integration/**/*.test.ts"],
            testTimeout: 30000,
            maxWorkers: Math.min(4, availableParallelism()),
            sequence: { groupOrder: 2 },
            env: {
              GIT_CONFIG_GLOBAL: path.join(noGitSettings, "gitconfig"),
              GIT_CONFIG_NOSYSTEM: "1",
              XDG_CONFIG_HOME: noGitSettings,
            },
          },
        },
      ],
    },
  };
});
