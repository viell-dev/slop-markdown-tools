import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { expect, it, onTestFailed } from "vitest";
import { copyOf, exitTrace, linkDirectory, noCompileCache, repository } from "../support/cli.js";

it("builds the published before/after site with identical rendered page content", async () => {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const builds: unknown[] = [];
  onTestFailed(() => {
    console.error(
      "VitePress-build failure phases:",
      JSON.stringify(
        {
          node: process.version,
          platform: process.platform,
          startedAt,
          elapsedMs: performance.now() - started,
          builds,
          resources: process.resourceUsage(),
        },
        null,
        2,
      ),
    );
  });
  const sites = ["before", "after"];
  const roots = await Promise.all(
    sites.map((site) => copyOf(`examples/workspaces/vitepress-site/${site}`)),
  );
  const pages: string[] = [];
  for (const [index, root] of roots.entries()) {
    await linkDirectory(path.join(repository, "node_modules"), path.join(root, "node_modules"));
    for (const name of ["index.md", "part.md"]) {
      const file = path.join(root, name);
      await writeFile(file, String.fromCharCode(0xfeff) + (await readFile(file, "utf8")));
    }
    const buildStartedAt = new Date().toISOString();
    const buildStarted = performance.now();
    const build = spawnSync(
      process.execPath,
      [
        ...exitTrace,
        path.join(repository, "node_modules/vitepress/bin/vitepress.js"),
        "build",
        root,
      ],
      {
        cwd: repository,
        encoding: "utf8",
        timeout: 45000,
        windowsHide: true,
        env: { ...process.env, ...noCompileCache },
      },
    );
    // VitePress prints `build complete` when its work is done, and the exit trace follows on
    // standard error; a failure prints both with the time each build took.
    builds.push({
      site: sites[index],
      startedAt: buildStartedAt,
      elapsedMs: performance.now() - buildStarted,
      status: build.status,
      signal: build.signal,
      error: build.error?.message,
      stdout: build.stdout,
      stderr: build.stderr,
    });
    expect(build.error, build.stdout + build.stderr).toBeUndefined();
    expect(build.status, build.stdout + build.stderr).toBe(0);
    const html = await readFile(path.join(root, ".vitepress/dist/index.html"), "utf8");
    expect(html).toContain('id="example-guide"');
    expect(html).toContain('id="included"');
    expect(html).toContain('href="./guide/install.html#cafe-au-lait"');
    expect(html).toContain('href="/logo.svg"');
    expect(html).toContain('<img src="/logo.svg"');
    expect(html).toContain('Links <a href="#included">a</a><a href="#included">b</a> end.');
    expect(html).toContain('class="language-js"');
    expect(html).toContain("hello");
    expect(await readFile(path.join(root, ".vitepress/dist/logo.svg"), "utf8")).toContain("<svg");
    const main = /<main\b[^>]*>([^]*?)<\/main>/.exec(html)?.[1];
    expect(main).toBeDefined();
    pages.push(main!);
  }
  expect(pages[1]).toBe(pages[0]);
}, 100000);
