// WebdriverIO's configuration for the Obsidian check, inside its container.
// OBSIDIAN_VERSION picks the Obsidian app version, `latest` by default.
import process from "node:process";

export const config = {
  runner: "local",
  framework: "mocha",
  specs: ["/check/obsidian.e2e.mjs"],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "obsidian",
      browserVersion: process.env.OBSIDIAN_VERSION || "latest",
      "wdio:obsidianOptions": { installerVersion: "latest", vault: "/check/vault" },
    },
  ],
  services: ["obsidian"],
  reporters: ["spec"],
  cacheDir: "/check/.obsidian-cache",
  mochaOpts: { ui: "bdd", timeout: 30 * 60 * 1000 },
  logLevel: "warn",
};
