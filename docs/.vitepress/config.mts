import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Markdown Tools",
  description:
    "Configurable Markdown linting and formatting for CommonMark, GitHub, Forgejo, Gitea, and Obsidian.",
  lang: "en",
  base: "/slop-markdown-tools/",
  head: [["meta", { name: "theme-color", content: "#12776c" }]],
  sitemap: { hostname: "https://viell-dev.github.io/slop-markdown-tools/" },
  themeConfig: {
    nav: [
      { text: "Quick start", link: "/quick-start" },
      { text: "Examples", link: "/examples" },
      { text: "Reference", link: "/configuration" },
      { text: "Contribute", link: "/contributing" },
    ],
    sidebar: [
      {
        text: "Start here",
        items: [
          { text: "Quick start", link: "/quick-start" },
          { text: "Examples", link: "/examples" },
          { text: "CLI workflows", link: "/cli" },
          { text: "Obsidian vaults", link: "/obsidian" },
        ],
      },
      {
        text: "Reference",
        items: [
          { text: "Configuration and rules", link: "/configuration" },
          { text: "Plugins and library API", link: "/plugins" },
        ],
      },
      {
        text: "Project",
        items: [
          { text: "Design and limitations", link: "/design" },
          { text: "Benchmarks", link: "/benchmarks" },
          { text: "Contributing and development", link: "/contributing" },
          { text: "Testing", link: "/testing" },
          { text: "Releases", link: "/releases" },
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
        'Early prerelease · <a href="https://github.com/viell-dev/slop-markdown-tools/blob/main/LICENSE">MIT licensed</a> · Agent-maintained',
    },
  },
});
