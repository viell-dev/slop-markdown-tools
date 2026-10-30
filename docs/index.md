---
layout: home
hero:
  name: mdrefine
  text: Lint and format Markdown
  tagline: One configuration for checks and formatting, for GitHub, Forgejo, Gitea, Obsidian, VitePress, or any CommonMark renderer.
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

```sh
npx mdrefine lint            # report what the rules find, without changing files
npx mdrefine format --write  # apply the fixes
```

`format` alone and `format --diff` preview the changes, and `format --check`
fails a CI job on unformatted files; [Getting
started](quick-start.md#preview-and-write) compares them.

mdrefine is meant to replace a general-purpose linter and formatter, such as
markdownlint and Prettier, for Markdown documents. The
[comparison](integrations.md#coming-from-prettier-or-markdownlint) lists each of
their checks with its rule here or the issue that tracks it.

[Get started](quick-start.md), browse the [rules](rules.md), or see
[examples](examples.md) of documents before and after formatting.
