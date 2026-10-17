import { copyFile } from "node:fs/promises";
import path from "node:path";
import { slug } from "github-slugger";
import { defineConfig } from "vitepress";

export default defineConfig({
  // The configuration's JSON Schema, at the address that the configuration page gives.
  async buildEnd({ root, outDir }) {
    const name = "config.schema.json";
    await copyFile(path.join(root, "..", name), path.join(outDir, name));
  },
  title: "mdrefine",
  description:
    "Configurable Markdown linting and formatting for CommonMark, GitHub, Forgejo, Gitea, and Obsidian.",
  lang: "en",
  base: "/slop-markdown-tools/",
  head: [["meta", { name: "theme-color", content: "#12776c" }]],
  sitemap: { hostname: "https://viell-dev.github.io/slop-markdown-tools/" },
  // Heading anchors as GitHub generates them, which is how the tool's own link check
  // validates the fragments of these pages: `## \`style/wrap\`` is `#stylewrap`.
  markdown: { anchor: { slugify: (text) => slug(text) } },
  themeConfig: {
    nav: [
      { text: "Get started", link: "/quick-start" },
      { text: "Rules", link: "/rules" },
      { text: "Reference", link: "/cli" },
      { text: "Changelog", link: "/changelog" },
      {
        text: "Contribute",
        link: "https://github.com/viell-dev/slop-markdown-tools/blob/main/CONTRIBUTING.md",
      },
    ],
    sidebar: [
      {
        text: "Guide",
        items: [
          { text: "Getting started", link: "/quick-start" },
          { text: "Examples", link: "/examples" },
          { text: "Obsidian vaults", link: "/obsidian" },
          { text: "Integrations", link: "/integrations" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Command line", link: "/cli" },
          { text: "Configuration", link: "/configuration" },
          { text: "Rules", link: "/rules" },
          { text: "Dialects", link: "/dialects" },
          { text: "Library API", link: "/api" },
          { text: "Plugins", link: "/plugins" },
        ],
      },
      {
        text: "Project",
        items: [
          { text: "How it works and its limits", link: "/design" },
          { text: "Benchmarks", link: "/benchmarks" },
          { text: "Versions", link: "/versions" },
          { text: "Changelog", link: "/changelog" },
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
