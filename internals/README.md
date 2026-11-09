# Maintainer notes

These notes hold the details that the user documentation in `docs/` leaves out:
enumerations of individual protections, internal limits, and the parser work
behind measured behavior. They are for the people and agents who maintain the
tool. The site does not build them and the npm package does not ship them; a
user page links a note where a reader may want the detail.

- [Obsidian protections](obsidian.md): each case where formatting leaves a note
  as written because Obsidian's two views read it differently.
- [Dialect notes](dialects.md): GitHub heading anchors around uncertain HTML,
  front matter, and math, and how the Forgejo and Gitea checks are run.
- [Configuration conversion notes](conversion.md): the glob subsets that
  conversion accepts, and how markdownlint's and Prettier's comments apply per
  region during the fallback.
- [VitePress notes](vitepress.md): retained component and code boundaries, and
  limits of include expansion.
- [Benchmark notes](benchmarks.md): the parser regression and corrections behind
  the benchmark page's limits.

Keep a note accurate in the pull request that changes what it describes, as for
the user documentation.

## Contributor procedures

Start with [CONTRIBUTING.md](../CONTRIBUTING.md) for setup, ordinary checks,
documentation and pull requests. The focused guides own specialist procedures:

- [Dependencies](dependencies.md): additions, maintained-parser reconciliation,
  updates, support-based ignores and tool pins.
- [Testing procedures](testing.md): build ownership, suite/fixture layout,
  native hosts and baseline updates, integration, performance and retention.
- [Verification map](verification.md): what each check proves, native routing,
  report contracts and evidence limits.
