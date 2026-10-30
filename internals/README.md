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
- [VitePress notes](vitepress.md): internal limits of include expansion.
- [Benchmark notes](benchmarks.md): the parser regression and corrections behind
  the benchmark page's limits.

How the checks run and what they prove is in
[CONTRIBUTING.md](../CONTRIBUTING.md#what-the-checks-prove). Keep a note
accurate in the pull request that changes what it describes, as for the user
documentation.
