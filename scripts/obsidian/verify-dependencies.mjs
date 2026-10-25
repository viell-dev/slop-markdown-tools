// Runs against the clean Linux harness installation, not the root development tree.
import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import process from "node:process";
import { log } from "node:console";
import { URL } from "node:url";
import { setupBrowser, setupDriver } from "@wdio/utils/node";
import { install } from "@puppeteer/browsers";
import { install as localInstall } from "./provided-binaries/index.mjs";
import { launcher as VerifiedLauncher } from "./service.mjs";
import { SevereServiceError } from "webdriverio";

const requireFromWdio = createRequire(import.meta.resolve("@wdio/utils/node"));
assert.equal(
  realpathSync(requireFromWdio.resolve("@puppeteer/browsers")),
  realpathSync(new URL("./provided-binaries/index.mjs", import.meta.url)),
);
assert.equal(install, localInstall);
for (const name of [
  "basic-ftp",
  "get-uri",
  "pac-proxy-agent",
  "proxy-agent",
  "extract-zip",
  "yauzl",
])
  assert.throws(() => requireFromWdio.resolve(name), { code: "MODULE_NOT_FOUND" });

const capabilities = {
  browserName: "chrome",
  browserVersion: "150.0.7871.250",
  "goog:chromeOptions": { binary: process.execPath },
  "wdio:chromedriverOptions": { binary: process.execPath },
};
const options = { cacheDir: "/tmp/mdrefine-provided-binaries-check" };
await setupBrowser(options, [capabilities]);
await setupDriver(options, [capabilities]);
// Without the driver, setupBrowser reaches the supplied-browser branch. Neither downloads.
const withoutDriver = { ...capabilities, "wdio:chromedriverOptions": {} };
await setupBrowser(options, [withoutDriver]);
await assert.rejects(
  setupDriver(options, [withoutDriver]),
  /automatic browser downloading is disabled/,
);
await assert.rejects(
  setupBrowser(options, [{ ...withoutDriver, "goog:chromeOptions": {} }]),
  /automatic browser downloading is disabled/,
);
// Exercise the actual wrapper after an asynchronous upstream setup, without downloading.
const upstream = Object.getPrototypeOf(VerifiedLauncher.prototype);
const original = upstream.onPrepare;
const service = new VerifiedLauncher({}, [], options);
let prepared = false;
try {
  upstream.onPrepare = async () => {
    await Promise.resolve();
    prepared = true;
  };
  await service.onPrepare({}, [capabilities]);
  assert.equal(prepared, true);
  for (const option of ["goog:chromeOptions", "wdio:chromedriverOptions"])
    await assert.rejects(service.onPrepare({}, [{ ...capabilities, [option]: {} }]), (error) => {
      assert.ok(error instanceof SevereServiceError);
      assert.match(error.message, /automatic browser downloading is disabled/);
      return true;
    });
} finally {
  upstream.onPrepare = original;
}
log("Clean harness resolves the local boundary; configured binaries work and fallbacks fail.");
