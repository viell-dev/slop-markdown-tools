import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { expect, it } from "vitest";
import * as boundary from "../../scripts/obsidian/provided-binaries/index.mjs";

it("rejects every automatic-browser operation instead of silently attempting another download", () => {
  for (const operation of [
    boundary.install,
    boundary.canDownload,
    boundary.resolveBuildId,
    boundary.detectBrowserPlatform,
    boundary.computeExecutablePath,
  ])
    expect(() => operation()).toThrow("automatic browser downloading is disabled");
});

it("checks both supplied executables before starting a session", () => {
  const capabilities = {
    "goog:chromeOptions": { binary: process.execPath },
    "wdio:chromedriverOptions": { binary: process.execPath },
  };
  expect(() => boundary.assertProvidedBinaries(capabilities)).not.toThrow();
  for (const option of ["goog:chromeOptions", "wdio:chromedriverOptions"] as const) {
    for (const binary of [undefined, "relative-executable", path.dirname(process.execPath)]) {
      expect(() =>
        boundary.assertProvidedBinaries({ ...capabilities, [option]: { binary } }),
      ).toThrow(`${option}.binary`);
    }
  }
});

it("reports an incomplete cache instead of allowing WebdriverIO to fall back", () => {
  const cache = mkdtempSync(path.join(tmpdir(), "mdrefine-binary-boundary-"));
  const binary = path.join(cache, "missing-browser");
  const capabilities = {
    "goog:chromeOptions": { binary },
    "wdio:chromedriverOptions": { binary: process.execPath },
  };
  try {
    expect(() => boundary.assertProvidedBinaries(capabilities)).toThrow("download cache");
    if (process.platform !== "win32") {
      writeFileSync(binary, "not executable", { mode: 0o644 });
      expect(() => boundary.assertProvidedBinaries(capabilities)).toThrow(
        "executable Obsidian browser",
      );
    }
  } finally {
    rmSync(cache, { recursive: true, force: true });
  }
});

it("removes the unused FTP, PAC and ZIP implementation from the resolved harness graph", () => {
  const lock = JSON.parse(
    readFileSync(new URL("../../scripts/obsidian/package-lock.json", import.meta.url), "utf8"),
  ) as { packages: Record<string, { resolved?: string; link?: boolean }> };
  expect(lock.packages["node_modules/@puppeteer/browsers"]).toEqual({
    resolved: "provided-binaries",
    link: true,
  });
  expect(
    Object.keys(lock.packages).filter((name) => name.endsWith("/@puppeteer/browsers")),
  ).toEqual(["node_modules/@puppeteer/browsers"]);
  expect(
    Object.keys(lock.packages).filter((name) =>
      /\/(?:basic-ftp|get-uri|pac-proxy-agent|proxy-agent|extract-zip|yauzl)$/.test(name),
    ),
  ).toEqual([]);
});
