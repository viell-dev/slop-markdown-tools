import path from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { copyOf, repository, linkDirectory } from "./support.js";

it("builds the published before/after site with identical rendered page content", async () => {
  const roots = await Promise.all([
    copyOf("examples/workspaces/vitepress-site/before"),
    copyOf("examples/workspaces/vitepress-site/after"),
  ]);
  const pages: string[] = [];
  for (const root of roots) {
    await linkDirectory(path.join(repository, "node_modules"), path.join(root, "node_modules"));
    for (const name of ["index.md", "part.md"]) {
      const file = path.join(root, name);
      await writeFile(file, String.fromCharCode(0xfeff) + (await readFile(file, "utf8")));
    }
    const build = spawnSync(
      process.execPath,
      [path.join(repository, "node_modules/vitepress/bin/vitepress.js"), "build", root],
      { cwd: repository, encoding: "utf8", timeout: 45000, windowsHide: true },
    );
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
