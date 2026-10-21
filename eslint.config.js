import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      ".npm-cache/**",
      "coverage/**",
      "artifacts/**",
      "**/.vitepress/cache/**",
      "**/.vitepress/.temp/**",
      "**/.vitepress/*.timestamp-*.mjs",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"],
    extends: [tseslint.configs.recommendedTypeCheckedOnly],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // Examples read like consumer scripts, which use Node's globals without importing them.
    files: ["examples/**/*.mjs"],
    languageOptions: { globals: { console: "readonly", process: "readonly", URL: "readonly" } },
  },
  {
    // The Obsidian check's spec runs in WebdriverIO's Mocha runner, and the functions that it
    // sends to Obsidian's page run there, where they can use the page's globals but no imports.
    files: ["scripts/obsidian/**/*.mjs"],
    languageOptions: {
      globals: {
        setTimeout: "readonly",
        describe: "readonly",
        it: "readonly",
        document: "readonly",
        Node: "readonly",
      },
    },
  },
);
