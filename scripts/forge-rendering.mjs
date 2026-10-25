// Disposable, loopback-only Forgejo/Gitea file-renderer checks (#486, #603).
// Build first; PROFILE/SEEDS/SEED/COUNT use renderer-settings.mjs. No owner credentials.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { format } from "../dist/index.js";
import { documentSeed, generateDocument } from "./rendering.mjs";
import { rendererSettings } from "./renderer-settings.mjs";
import { classifyDifferences, knownSources } from "./renderer-differences.mjs";
import { forgeFixtures as fixtures, fileFixtures } from "../tests/fixtures/renderers/forges.mjs";
import { fileMarkup, forgeHtml } from "./forge-html.mjs";
import { images, validateForgeEvidence } from "./forge-evidence.mjs";
import {
  createRendererReport,
  startDocument,
  validateRendererReport,
} from "./renderer-evidence.mjs";

const { fetch, AbortSignal } = globalThis;
const options = rendererSettings(process.env);
const out = path.resolve("artifacts/forge-rendering");
await mkdir(out, { recursive: true });
await rm(path.join(out, "report.json"), { force: true });
function docker(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", args, { windowsHide: true });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) =>
      status === 0
        ? resolve(args[0] === "logs" ? stdout + stderr : stdout.trim())
        : reject(new Error(`Docker ${args[0]} failed (${status}): ${stderr}`)),
    );
  });
}

const renderers = [],
  differences = [],
  known = [],
  stale = [];
const report = {
  ...createRendererReport("forges", options),
  renderers,
  unexpected: differences,
  known,
  stale,
};
const checkpoint = async () => {
  report.compared = renderers.reduce((sum, item) => sum + item.compared, 0);
  await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2) + "\n");
};
await checkpoint();
for (const image of images) {
  const directory = path.join(out, image.name);
  await mkdir(directory, { recursive: true });
  const container = `mdrefine-${image.name}-${randomUUID()}`;
  const password = `Synthetic-${randomUUID()}-Aa1!`;
  let started = false;
  try {
    await docker(
      "create",
      "--name",
      container,
      "--publish",
      "127.0.0.1::3000",
      "--tmpfs",
      "/data:rw,size=512m,mode=755",
      ...Object.entries({
        database__DB_TYPE: "sqlite3",
        security__INSTALL_LOCK: "true",
        service__DISABLE_REGISTRATION: "true",
        server__DISABLE_SSH: "true",
        server__OFFLINE_MODE: "true",
        actions__ENABLED: "false",
        log__LEVEL: "Warn",
      }).flatMap(([key, value]) => ["--env", `GITEA__${key}=${value}`]),
      image.image,
    );
    started = true;
    await docker("start", container);
    const address = await docker("port", container, "3000/tcp");
    assert.match(address, /^127\.0\.0\.1:\d+$/);
    const base = `http://${address}`;
    const deadline = Date.now() + 120000;
    let version;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`${base}/api/v1/version`, {
          signal: AbortSignal.timeout(3000),
        });
        if (response.ok) {
          version = (await response.json()).version;
          break;
        }
      } catch {
        /* The new service may not be listening yet; failure remains bounded. */
      }
      await delay(500);
    }
    assert.equal(
      version?.split("+")[0],
      image.version,
      `${image.name} did not start at the pinned version`,
    );
    const observed = { ...image, observedVersion: version, compared: 0, fileViews: 0 };
    renderers.push(observed);
    await docker(
      "exec",
      "--user",
      "git",
      container,
      image.name,
      "--config",
      "/data/gitea/conf/app.ini",
      "admin",
      "user",
      "create",
      "--username",
      "mdrefine",
      "--email",
      "synthetic@example.invalid",
      "--password",
      password,
      "--admin",
      "--must-change-password=false",
    );
    const auth = `Basic ${Buffer.from(`mdrefine:${password}`).toString("base64")}`;
    async function request(url, method = "GET", body, authenticated = false) {
      const response = await fetch(`${base}${url}`, {
        method,
        signal: AbortSignal.timeout(30000),
        headers: {
          "Content-Type": "application/json",
          ...(authenticated ? { Authorization: auth } : {}),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      assert(
        response.ok,
        `${image.name} ${method} ${url}: HTTP ${response.status}: ${text.slice(0, 1000)}`,
      );
      return text;
    }
    async function render(source) {
      return request(
        "/api/v1/markup",
        "POST",
        {
          Mode: "file",
          Text: source,
          FilePath: "case.md",
          Context:
            image.name === "forgejo"
              ? `${base}/mdrefine/corpus`
              : "/mdrefine/corpus/src/branch/main",
          ...(image.name === "forgejo" ? { BranchPath: "branch/main" } : {}),
        },
        true,
      );
    }
    // Calibrate against real response differences before trusting an empty diff list.
    assert.notEqual(
      forgeHtml(await render("First text.\n")),
      forgeHtml(await render("Changed text.\n")),
    );
    report.controls.push({ name: `${image.name}/text-difference`, passed: true });
    assert.match(await render("$x^2$\n"), /language-math/);
    report.controls.push({ name: `${image.name}/math-recognition`, passed: true });
    await request(
      "/api/v1/user/repos",
      "POST",
      { name: "corpus", auto_init: true, default_branch: "main" },
      true,
    );
    const config = { extends: ["recommended", image.name] };
    const found = [];
    let compared = 0,
      fileViews = 0;
    async function compare(name, source, view, renderer, force = false) {
      const record = startDocument(
        report,
        `${image.name}/${view === "repository-file" ? "repository-" : ""}${name}`,
        80,
      );
      const output = format(source, { config }).output;
      record.changed = output !== source;
      if (output === source && !force) {
        record.views.push({ name: view, changed: false, status: "unchanged" });
        record.completed = true;
        return;
      }
      compared++;
      const before = await renderer(source),
        after = await renderer(output);
      record.views.push({ name: view, changed: record.changed, status: "compared" });
      record.completed = true;
      observed.compared = compared;
      observed.fileViews = fileViews;
      if (forgeHtml(before, source) === forgeHtml(after, output)) return;
      found.push({ name, source, output, view });
      const stem = path.join(directory, `difference-${found.length}`);
      for (const [suffix, content] of Object.entries({
        "before.md": source,
        "after.md": output,
        "before.html": before,
        "after.html": after,
      }))
        await writeFile(`${stem}-${suffix}`, content);
    }
    const cases = fixtures.map((fixture) => ({ ...fixture }));
    for (const seed of options.seeds)
      for (let index = 0; index < options.count; index++)
        cases.push({
          name: `generated-${seed}-${index}`,
          source: generateDocument(documentSeed(seed, index), image.name, options.profile),
        });
    if (options.profile === "adversarial")
      knownSources(image.name).forEach((source, index) =>
        cases.push({ name: `known-${index}`, source }),
      );
    for (const { name, source } of cases) await compare(name, source, "file-api", render);
    for (const fixture of fileFixtures) {
      let sha;
      await compare(
        fixture.name,
        fixture.source,
        "repository-file",
        async (source) => {
          const result = JSON.parse(
            await request(
              `/api/v1/repos/mdrefine/corpus/contents/nested/${fixture.name}.md`,
              sha ? "PUT" : "POST",
              {
                content: Buffer.from(source).toString("base64"),
                branch: "main",
                message: "Synthetic renderer fixture",
                ...(sha ? { sha } : {}),
              },
              true,
            ),
          );
          sha = result.content.sha;
          const markup = fileMarkup(
            await request(
              `/mdrefine/corpus/src/branch/main/nested/${fixture.name}.md?display=rendered`,
            ),
          );
          assert.match(
            markup,
            /\bid="(?:user-content-)?[^"]+"/,
            "File view must expose anchor targets",
          );
          fileViews++;
          return markup;
        },
        true,
      );
    }
    const classified = classifyDifferences(image.name, options.profile, found);
    differences.push(
      ...classified.unexpected.map((difference) => ({ renderer: image.name, ...difference })),
    );
    known.push(...classified.known.map((difference) => ({ renderer: image.name, ...difference })));
    stale.push(...classified.stale);
    report.controls.push({ name: `${image.name}/repository-anchors`, passed: true });
    process.stdout.write(
      `${image.name} ${version}: ${compared} comparisons, ${fileViews} actual file views, ${found.length} differences.\n`,
    );
  } finally {
    try {
      await checkpoint();
    } finally {
      if (started) {
        try {
          await writeFile(path.join(directory, "server.log"), await docker("logs", container));
        } finally {
          await docker("rm", "--force", "--volumes", container);
        }
      }
    }
  }
}
await checkpoint();
validateForgeEvidence(report);
validateRendererReport(report, options, "forges");
assert.equal(
  differences.length,
  0,
  "Unexpected forge rendering differences; see artifacts/forge-rendering",
);
assert.equal(stale.length, 0, "Stale known forge differences");
