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

## Pull requests and compatibility

All changes to `main` require a pull request and passing CI. This includes
prereleases, version bumps, documentation, and dependency updates. Do not push
directly, bypass required checks, or rewrite shared history. Keep discussion
respectful and focused on reproducible behavior; harassment and disclosure of
private data are not acceptable. Contributions are provided under the MIT
license.

The branch policy requires the three CI checks and resolved review threads. It
does not require approval from a second account: this project is
agent-maintained and cannot assume another maintainer is available. Request
independent review when available, especially for file writes and release
automation. Passing CI is not a claim of human review.

The beta API and configuration may change; record changes in versioned release
notes and explain migration steps for incompatible behavior. Once published,
versions and release tags are never replaced. Follow the
[release procedure](releases.md) for preparation and publication. Security
reports belong in the private channel described in
[SECURITY.md](https://github.com/viell-dev/slop-markdown-tools/blob/main/SECURITY.md).

## Issue and pull request labels

Use one primary `Type:` label on every issue and PR, and at most one `Status:`
label describing the current disposition or next action. The type describes what
the item is about; a feature implementation PR also uses
`Type: Feature Request`. For mixed historical items, choose the main purpose and
explain separate decisions in comments. Split new requests when their parts need
independent scope decisions. Do not add priority labels.

The
[label catalog](https://github.com/viell-dev/slop-markdown-tools/blob/main/.github/labels.json)
is the source of truth for exact names, descriptions, and hexadecimal colors.
Keep it, this guide, GitHub, issue templates, and Dependabot settings aligned.
Use the GitHub UI or the existing `gh` CLI; no label-sync service is required.

| Label                       | Color     | Use                                                                          |
| --------------------------- | --------- | ---------------------------------------------------------------------------- |
| `Type: Bug`                 | `#d73a4a` | Incorrect behavior, broken functionality, or a regression.                   |
| `Type: Enhancement`         | `#a2eeef` | Improve an existing capability, including usability or performance.          |
| `Type: Feature Request`     | `#0e8a16` | Add a new independently useful capability or rule.                           |
| `Type: Maintenance`         | `#6a737d` | Dependencies, CI, releases, refactoring, or repository upkeep.               |
| `Type: Documentation`       | `#0075ca` | Documentation, examples, or contributor instructions.                        |
| `Type: Discussion`          | `#5319e7` | Explore a design or project direction before an actionable proposal.         |
| `Type: Question`            | `#d876e3` | Ask how the project works or how to use it.                                  |
| `Status: Needs Triage`      | `#ededed` | Awaiting maintainer review and a scope decision.                             |
| `Status: Confirmed`         | `#0e8a16` | Reproduced defect or accepted actionable request; not a delivery commitment. |
| `Status: Needs Information` | `#fbca04` | Waiting for reporter details, answers, or validation results.                |
| `Status: Blocked`           | `#d93f0b` | Accepted work is waiting on an identified external dependency.               |
| `Status: Can't Reproduce`   | `#fef2c0` | A documented reproduction attempt did not reproduce the report.              |
| `Status: Duplicate`         | `#cfd3d7` | Already tracked elsewhere; link the canonical issue or PR.                   |
| `Status: Won't Do`          | `#666666` | Declined as out of scope or unsuitable in its proposed form.                 |
| `Good First Issue`          | `#7057ff` | A scoped, ready task with a clear approach and beginner-friendly validation. |
| `Help Wanted`               | `#008672` | A scoped, accepted task for which outside contributions are welcome.         |

Review labels whenever answering, triaging, implementing, closing, reopening, or
otherwise updating an issue or PR:

- Replace `Status: Needs Triage` after review. Use `Status: Confirmed` only for
  a reproduced defect or an accepted request within project scope; neither
  reproduction nor acceptance follows automatically from a report.
- When waiting on the reporter, use `Status: Needs Information` and state what
  evidence is needed. Use `Status: Blocked` for an identified external
  dependency, with a link and an unblock condition. Choose the immediate next
  action rather than stacking statuses.
- Use `Status: Can't Reproduce` only after documenting the attempted version,
  input, and result. An incomplete report first needs information.
- On duplicate closure, link the canonical item and retain `Status: Duplicate`.
  On rejection, explain the scope or suitability decision and retain
  `Status: Won't Do`. A declined proposal can be reconsidered with new evidence.
- On successful completion or merge, remove transient status labels and retain
  the type. GitHub's open/closed/merged state records completion; there is no
  redundant Done or Merged label. A closed, unmerged PR should retain its
  applicable disposition, rather than being labeled as completed.
- On reopening, reassess the evidence and replace the old disposition; do not
  carry a stale rejection, duplicate, or information request forward.
- Apply `Good First Issue` only to a ready, well-explained beginner task,
  together with `Help Wanted`. Remove both when the item closes or is no longer
  ready for contribution. Waiting for a reporter's private-workspace benchmark
  is not a general help request.

Colors follow familiar GitHub cues: red for defects, blue for documentation,
green for accepted work, yellow/orange for missing information or blockers, and
gray for neutral or declined dispositions. Names carry the meaning without
relying on color. The unprefixed contributor labels follow
[GitHub's label conventions](https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work/managing-labels);
the readiness criteria draw on the
[Kubernetes contributor guide](https://www.kubernetes.dev/docs/guide/help-wanted/).
The `Type:` / `Status:` grouping also appears in
[community label catalogs](https://gist.github.com/dysfunc/fc722e865a6a960a2d9c5ecf43f5a963);
this repository intentionally uses a smaller set.

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

GitHub Actions runs the full `check` and dependency audit on Linux with
Node.js 24. Linux with Node.js 22 and Windows with Node.js 24 run the build and
tests; all three jobs verify the installed package. Linting, formatting checks,
and documentation builds run once rather than on every platform. Superseded PR
runs are canceled.

Runtime dependencies have no OS-specific installation constraints. Development
tooling does include native platform packages, but that alone does not justify
repeating the full toolchain matrix. Windows coverage protects filesystem path
handling and installed command behavior; it has already caught a path-alias
regression. macOS is not a routine CI target.

Keep changes scoped and describe remaining limitations in the pull request.
Agent contributors should also read the repository's
[AGENTS.md](https://github.com/viell-dev/slop-markdown-tools/blob/main/AGENTS.md).

## Write and preview documentation

The site source lives in `docs/` on `main`. Edit these Markdown files directly;
VitePress supplies navigation, local search, and rendering. The site uses
VitePress 2 alpha because the stable 1.6 line currently retains vulnerable
development dependencies; site builds are verified in CI. Markdown Tools formats
and lints the site's own Markdown at its default 80-column width.

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
