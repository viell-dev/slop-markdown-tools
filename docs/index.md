---
layout: home
hero:
  name: mdrefine
  text: Lint and format Markdown
  tagline: One configuration for checks and formatting, for documents rendered by GitHub, Forgejo, Gitea, Obsidian, VitePress, or any CommonMark renderer.
  actions:
    - theme: brand
      text: Get started
      link: /quick-start
    - theme: alt
      text: Examples
      link: /examples
features:
  - title: Check, preview, then write
    details: Lint without changing files, read the diff, and write when ready. A JSON report and exit codes serve CI, scripts, and agents.
  - title: Changes only what its rules target
    details: Formatting edits the source in place, keeps everything else byte for byte, and refuses an edit that would change what a document means.
  - title: Knows where it renders
    details: Tables, math, wikilinks, callouts, and heading anchors are read as GitHub, Forgejo, Gitea, Obsidian, or VitePress read them, and local links are checked the same way.
---

mdrefine is meant to replace a general-purpose linter and formatter, such as
markdownlint and Prettier, for Markdown documents.
[Integrations](integrations.md#coming-from-prettier-or-markdownlint) shows which
of their checks have a rule here so far.

```sh
npx mdrefine lint
npx mdrefine format
npx mdrefine format --diff
npx mdrefine format --write
npx mdrefine format --check
```

Bare `format` prints a diff and fails when files would change. Use `--diff` for
a preview whose changes alone exit `0`, or `--write` to apply them.

[Get started](quick-start.md), browse the [rules](rules.md), or see
[examples](examples.md) of documents before and after formatting.
