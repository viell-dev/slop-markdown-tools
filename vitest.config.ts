import { defineConfig } from "vitest/config";

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
        },
      },
    ],
  },
});
