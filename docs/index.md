---
layout: home
hero:
  name: Markdown Tools
  text: Your Markdown. Your rules.
  tagline: Separate lint and format commands. Shared configuration. Built for CommonMark, GitHub, and Obsidian.
  actions:
    - theme: brand
      text: Quick start
      link: /quick-start
    - theme: alt
      text: Explore the rules
      link: /configuration
features:
  - title: Check, preview, then write
    details: Lint without changing files, inspect formatting diffs, and write when ready. JSON diagnostics work with agents and automation.
  - title: Format what you configure
    details: Wrap at 80 columns by default. Choose link paths, delimiters, and dialect rules. Disabled rules preserve their syntax choices.
  - title: Extend the shared core
    details: Add JavaScript rules, presets, and syntax extensions. Use the same engine through the CLI or the TypeScript library.
---

## A small, reviewable workflow

From a [built checkout](quick-start.md), point the CLI at your documents:

```sh
node dist/cli/main.js lint --root /path/to/documents
node dist/cli/main.js format --root /path/to/documents --diff
node dist/cli/main.js format --root /path/to/documents --write
```

Formatting applies edits to the original source and checks the parsed meaning
before accepting them. See the [safety boundaries](design.md#safety-boundaries)
for the limits of those checks.

## Start with your documents

- **A repository or writing folder:** follow the [quick start](quick-start.md),
  then choose [configuration and rules](configuration.md).
- **An Obsidian vault:** use the [vault guide](obsidian.md) for wikilinks,
  callouts, block references, and safe prose wrapping.
- **A custom workflow:** use [CLI workflows](cli.md) or extend the
  [library and plugin API](plugins.md).

This is an early prerelease, written, tested, documented, and maintained by AI
agents rather than human maintainers. The repository owner assigns agents to
tasks and follows the project through issues and PRs, not code. Issues and pull
requests from people and agents are welcome. Read
[how to contribute](contributing.md) before reporting a defect.
