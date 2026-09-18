# Contributing and development

This project is developed and maintained by AI agents. It is **not
human-maintained**; do not assume that a person has reviewed generated changes.
Issues and pull requests from people and agents are welcome.

## Report a defect

Include the version, command, configuration, minimal Markdown input, actual
output, and expected rendering. A screenshot can explain a visible defect, but
the Markdown source is needed to reproduce it. Include JSON diagnostics when
available, and remove private content before posting examples.

Use the [issue tracker](https://github.com/viell-dev/slop-markdown-tools/issues)
for reproducible defects and feature requests. Agents should open issues only
when their operator has authorized publishing them.

Document corruption and changed rendering take priority over new style options.
Fixes should include a synthetic regression example, preserve meaning, and
verify that a second formatting pass leaves the output unchanged.

## Develop locally

Follow the [checkout setup](quick-start.md#install-from-the-repository), then:

```sh
npm run check
npm run test:package
```

`check` runs TypeScript checks, ESLint, formatting checks, the documentation
site build, and regression/property/CLI tests. `test:package` packs the tool,
installs it into a temporary consumer project, and exercises the installed CLI
and library. It can require access to the npm registry.

GitHub Actions verifies Linux with Node.js 22 and 24, plus macOS and Windows
with Node.js 24. Keep changes scoped and describe remaining limitations in the
pull request. Agent contributors should also read the repository's
[AGENTS.md](https://github.com/viell-dev/slop-markdown-tools/blob/main/AGENTS.md).

## Write and preview documentation

The site source lives in `docs/` on `main`. Edit these Markdown files directly;
VitePress supplies navigation, local search, and rendering. Markdown Tools
formats and lints the site's own Markdown at its default 80-column width.

```sh
npm run format:docs
npm run format:docs:check
npm run docs:dev
```

To inspect the production build:

```sh
npm run docs:build
npm run docs:preview
```

Open the URL printed by the preview server, including the
`/slop-markdown-tools/` base path. The site build fails on unresolved internal
page links; Markdown linting also checks local heading references.

Prettier formats implementation and configuration files and excludes Markdown.
`npm run format` runs both formatters. Synthetic fixtures under
`tests/fixtures/` are excluded from documentation formatting.

## Publish the site

The Pages workflow builds the static site from `main` and deploys only
`docs/.vitepress/dist/` as a GitHub Pages artifact. Generated output is ignored
by Git and excluded from the npm package. There is no publishing branch to
maintain. Pull requests build the site through CI without deploying it.

GitHub Pages must use **GitHub Actions** as its publishing source. Deployment
uses the `github-pages` environment and the workflow's short-lived token. See
GitHub's
[custom workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)
for deployment settings.
