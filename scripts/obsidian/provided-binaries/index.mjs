// This is the seven-import boundary used by @wdio/utils 9.32.0, not a browser installer.
// wdio-obsidian-service supplies both binaries through obsidian-launcher instead.
// Maintenance ownership, verification and removal conditions: ../README.md and #639/#640.
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";

export const Browser = Object.freeze({
  CHROME: "chrome",
  CHROMEHEADLESSSHELL: "chrome-headless-shell",
  CHROMIUM: "chromium",
  FIREFOX: "firefox",
  CHROMEDRIVER: "chromedriver",
});

export const ChromeReleaseChannel = Object.freeze({
  STABLE: "stable",
  DEV: "dev",
  CANARY: "canary",
  BETA: "beta",
});

function unavailable(operation) {
  throw new Error(
    `Obsidian harness: automatic browser downloading is disabled (${operation}). ` +
      "wdio-obsidian-service must supply the browser and ChromeDriver executables; " +
      "check its setup and the download cache.",
  );
}

export const install = () => unavailable("install");
export const canDownload = () => unavailable("canDownload");
export const resolveBuildId = () => unavailable("resolveBuildId");
export const detectBrowserPlatform = () => unavailable("detectBrowserPlatform");
export const computeExecutablePath = () => unavailable("computeExecutablePath");

/** Reject missing or incomplete service setup before WebdriverIO can start a fallback. */
export function assertProvidedBinaries(capabilities) {
  for (const [option, label] of [
    ["goog:chromeOptions", "Obsidian browser"],
    ["wdio:chromedriverOptions", "ChromeDriver"],
  ]) {
    const binary = capabilities[option]?.binary;
    try {
      if (typeof binary !== "string" || !path.isAbsolute(binary) || !statSync(binary).isFile())
        throw new Error("not an absolute executable file");
      accessSync(binary, constants.X_OK);
    } catch (cause) {
      throw new Error(
        `Obsidian harness: wdio-obsidian-service did not supply an executable ${label} ` +
          `(${option}.binary). Check its setup and the download cache; ` +
          "automatic browser downloading is disabled.",
        { cause },
      );
    }
  }
}
