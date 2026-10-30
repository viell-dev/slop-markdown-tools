import { readdirSync, readFileSync } from "node:fs";
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { slug } from "github-slugger";
import { defineConfig } from "vitepress";

// The release notes, one page per minor version in docs/release-notes/, newest first.
const releaseNotes = readdirSync(fileURLToPath(new URL("../release-notes/", import.meta.url)))
  .filter((name) => /^\d+\.\d+\.md$/.test(name))
  .map((name) => name.slice(0, -".md".length))
  .sort((a, b) => b.localeCompare(a, "en", { numeric: true }))
  .map((version) => ({ text: `What's new in ${version}`, link: `/release-notes/${version}` }));
// The version the site describes: the Pages workflow builds it from that release's tag.
const { version } = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as { version: string };

type Item = { text: string; link: string; items?: unknown[]; collapsed?: boolean };
const guide: Item[] = [
  { text: "Getting started", link: "/quick-start" },
  { text: "Examples", link: "/examples" },
  { text: "Obsidian vaults", link: "/obsidian" },
  { text: "Integrations", link: "/integrations" },
];
const reference: Item[] = [
  { text: "Command line", link: "/cli" },
  { text: "Configuration", link: "/configuration" },
  { text: "Rules", link: "/rules" },
  { text: "Dialects", link: "/dialects" },
  { text: "VitePress", link: "/vitepress" },
  { text: "Library API", link: "/api" },
  { text: "Plugins", link: "/plugins" },
];
const releases: Item[] = [
  ...releaseNotes,
  { text: "Upgrading", link: "/upgrading" },
  { text: "Changelog", link: "/changelog" },
];
// A menu in the top bar lists the pages without their nested sidebar groups.
const menu = (items: Item[]) => items.map(({ text, link }) => ({ text, link }));

export default defineConfig({
  // The configuration's JSON Schema, at the address that the configuration page gives.
  async buildEnd({ root, outDir }) {
    const name = "config.schema.json";
    await copyFile(path.join(root, "..", name), path.join(outDir, name));
  },
  title: "mdrefine",
  description:
    "Configurable Markdown linting and formatting for CommonMark, GitHub, Forgejo, Gitea, Obsidian, and VitePress.",
  lang: "en",
  base: "/slop-markdown-tools/",
  head: [["meta", { name: "theme-color", content: "#12776c" }]],
  sitemap: { hostname: "https://viell-dev.github.io/slop-markdown-tools/" },
  // Heading anchors as GitHub generates them, which is how the tool's own link check
  // validates the fragments of these pages: `## \`style/wrap\`` is `#stylewrap`.
  markdown: {
    anchor: { slugify: (text) => slug(text) },
    // Code spans show `{{` as written, as on GitHub, where Vue would read it
    // as the start of an interpolation.
    config(md) {
      md.core.ruler.push("code_inline_v_pre", (state) => {
        for (const token of state.tokens)
          for (const child of token.children ?? [])
            if (child.type === "code_inline") child.attrSet("v-pre", "");
      });
    },
  },
  themeConfig: {
    nav: [
      { text: "Guide", items: menu(guide) },
      { text: "Reference", items: menu(reference) },
      { text: "Examples", link: "/examples" },
      { text: version, items: [...menu(releases), { text: "Versions", link: "/versions" }] },
      {
        text: "Contribute",
        link: "https://github.com/viell-dev/slop-markdown-tools/blob/main/CONTRIBUTING.md",
      },
    ],
    sidebar: [
      { text: "Guide", items: guide },
      { text: "Reference", items: reference },
      {
        text: "About",
        items: [
          { text: "How it works and its limits", link: "/design" },
          { text: "Benchmarks", link: "/benchmarks" },
          { text: "Versions", link: "/versions" },
          ...releases,
        ],
      },
    ],
    search: { provider: "local" },
    outline: { level: [2, 3] },
    socialLinks: [{ icon: "github", link: "https://github.com/viell-dev/slop-markdown-tools" }],
    editLink: {
      pattern: "https://github.com/viell-dev/slop-markdown-tools/edit/main/docs/:path",
      text: "Edit this page on GitHub",
    },
    footer: {
      message:
        'Pre-1.0 · <a href="https://github.com/viell-dev/slop-markdown-tools/blob/main/LICENSE">MIT licensed</a> · Agent-maintained',
    },
  },
});
