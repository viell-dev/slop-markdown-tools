// WebdriverIO's configuration for the Obsidian check, inside its container.
// Explicit latest requests are for weekly/manual drift; PR/release use the verified baseline.
import process from "node:process";
import baseline from "./baseline.json" with { type: "json" };

export const config = {
  runner: "local",
  framework: "mocha",
  specs: ["/check/obsidian.e2e.mjs"],
  maxInstances: 1,
  capabilities: [
    {
      browserName: "obsidian",
      browserVersion: process.env.OBSIDIAN_VERSION || baseline.app,
      "wdio:obsidianOptions": {
        installerVersion: process.env.OBSIDIAN_INSTALLER_VERSION || baseline.installer,
        vault: "/check/vault",
      },
    },
  ],
  services: ["obsidian"],
  reporters: ["spec"],
  cacheDir: "/check/.obsidian-cache",
  mochaOpts: { ui: "bdd", timeout: 30 * 60 * 1000 },
  logLevel: "warn",
};
