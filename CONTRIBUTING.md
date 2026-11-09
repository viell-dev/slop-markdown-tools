# Contributing

Issues and pull requests from people and from agents are welcome. The project is
maintained by AI agents, as the [README](README.md#status) says, and its owner
follows it through issue and pull request descriptions rather than code, so
write them for a reader who has not seen the code. Agents maintaining the
repository also follow
[AGENTS.md](https://github.com/viell-dev/slop-markdown-tools/blob/main/AGENTS.md).
Everyone follows the [code of conduct](CODE_OF_CONDUCT.md).

If an agent wrote your issue or pull request, open it with a short note, such as
a `> [!NOTE]` callout, that says so, names the model and the tool that ran it,
and says whether you reviewed it. The maintaining agents mark their own posts
the same way.

## Choose a task

After [setup](#set-up), follow the ordinary [checks](#checks) and [pull
request](#pull-requests) path. These routes point to the additional procedure
each change needs:

| Change                             | Procedure                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User documentation                 | [Documentation](#documentation), including page and rule-writing guidance                                                                                                                                                                                                                                                                                                             |
| Rule or engine behavior            | [Test ownership](https://github.com/viell-dev/slop-markdown-tools/blob/main/internals/testing.md#tests) and [verification map](https://github.com/viell-dev/slop-markdown-tools/blob/main/internals/verification.md)                                                                                                                                                                  |
| Parser or dependencies             | [Dependency and parser maintenance](https://github.com/viell-dev/slop-markdown-tools/blob/main/internals/dependencies.md), then the [verification map](https://github.com/viell-dev/slop-markdown-tools/blob/main/internals/verification.md)                                                                                                                                          |
| Native renderer or harness         | [Host procedures](https://github.com/viell-dev/slop-markdown-tools/blob/main/internals/testing.md#reference-and-github-rendering), [Obsidian baseline](https://github.com/viell-dev/slop-markdown-tools/blob/main/internals/testing.md#advancing-the-obsidian-baseline), and [verification map](https://github.com/viell-dev/slop-markdown-tools/blob/main/internals/verification.md) |
| Release or current-site correction | [Release procedure](https://github.com/viell-dev/slop-markdown-tools/blob/main/RELEASING.md)                                                                                                                                                                                                                                                                                          |

The specialist guides live in the source repository; the links also work from
the installed npm package. The headings below retain routes for older links.

## Report a defect

Search the open and closed
[issues](https://github.com/viell-dev/slop-markdown-tools/issues) first, then
open one with the bug form's details:

- the mdrefine version, the Node.js version, the operating system, and the exact
  command;
- the dialect in effect, and the configuration, with any plugins;
- a minimal Markdown input, synthetic or public;
- the actual output or diagnostics, with the `--json` report when you have one;
- the expected output, and how the rendering differs.

A screenshot can show a rendering difference, but only the Markdown source
reproduces it. Remove private content from every example. Agents should open an
issue only when their operator has authorized publishing it. Report
vulnerabilities privately, as [SECURITY.md](SECURITY.md) describes.

## Set up

Development needs Node.js 22.22.2 or newer, or 24.15.0 or newer, and npm 10 or
newer. `.nvmrc` names 24, the version that the checks and releases run on, so
`nvm use` or `fnm use` selects it.

```sh
git clone https://github.com/viell-dev/slop-markdown-tools.git
cd slop-markdown-tools
nvm install # or: fnm use --install-if-missing
npm ci
npm run build
node dist/cli/main.js --help
```

In a checkout, `node dist/cli/main.js` takes the place of `npx mdrefine`. A
built checkout can also be installed into another project as a local dependency.

## Checks

```sh
npm run check
npm run test:package
```

`check` runs the TypeScript checks, ESLint, Prettier on everything but Markdown,
the tool's own lint and format check of the Markdown, the documentation site's
build, and all three test suites. `test:package` packs the package, installs it
into a temporary project with npm and again with pnpm, whose strict layout lets
a package use only the dependencies it declares, and runs the installed command,
the library through `import` and `require()`, a shipped example, and TypeScript
consumers of the published types. npm fetches the pinned pnpm into the
repository's cache, and both installations can need access to the npm registry.

For build ownership, staging recovery and invocation receipts, follow the
[testing
procedures](https://github.com/viell-dev/slop-markdown-tools/blob/main/internals/testing.md#build-and-invocation-ownership).

ESLint uses the project's TypeScript types when checking source and tests. It
also checks the JavaScript scripts and examples with their existing environment
settings. `npm run typecheck` also checks the maintained parser fragments with
their strict TypeScript configuration; ESLint checks those implementations with
the same project. Their cursor-guarded array walks use ordinary indexed access,
without TypeScript's additional unchecked-index option. Integration tests
validate CLI JSON before using it; the shared readers in `tests/support/json.ts`
keep the original payload, so assertions still catch unexpected keys.

ESLint also rejects a regular expression literal with the `u` flag in which a
bracketed class stands right before the end-of-input `$` without a start anchor,
because Node.js 26 does not match a surrogate pair there (#743). Test the whole
code point with a start-anchored pattern, quantify the class, or use the `v`
flag instead; `tests/integration/lint-guards.test.ts` checks the shapes it
covers.

The configuration's JSON Schema is `src/config/resolve.ts`'s `configSchema`.
`npm run schema` writes it to `config.schema.json`, which the package ships and
the site serves; a test fails when the two differ.

GitHub Actions runs static checks, performance/integration and a dependency
audit on Linux with Node.js 24, with unit coverage on a separate Linux 24
runner; the build and tests on Linux with Node.js 22.12.0, the lowest version
the package supports, on Windows with Node.js 24, and on Linux with Node.js 26,
and `test:package` on all four. `main` requires the first three, `Unit coverage`
and the PR-only `Native checks` decision in the [verification
map](https://github.com/viell-dev/slop-markdown-tools/blob/main/internals/verification.md).
The Node.js 26 job is not required, so that a defect only the newest Node.js
shows does not block unrelated merges; its failures get an issue. Windows covers
file paths, access control lists, junctions, and the installed command; macOS is
not a routine target.

## Dependencies

The [dependency
guide](https://github.com/viell-dev/slop-markdown-tools/blob/main/internals/dependencies.md)
owns additions, parser reconciliation, security handling, update groups, ignored
version lines and tool pins.

### Update groups

See [update
groups](https://github.com/viell-dev/slop-markdown-tools/blob/main/internals/dependencies.md#update-groups).

### Revisiting ignores and tool pins

See [ignores and tool
pins](https://github.com/viell-dev/slop-markdown-tools/blob/main/internals/dependencies.md#revisiting-ignores-and-tool-pins).

## Tests

The [testing
procedures](https://github.com/viell-dev/slop-markdown-tools/blob/main/internals/testing.md)
cover suite ownership, fixtures, native hosts and baseline updates, integration,
performance and memory evidence. Use the [verification
map](https://github.com/viell-dev/slop-markdown-tools/blob/main/internals/verification.md)
to choose the checks for a change.

## What the checks prove

The [verification
map](https://github.com/viell-dev/slop-markdown-tools/blob/main/internals/verification.md)
owns the check coverage, native routing, report contracts and evidence limits.

## Bounded renderer work

PR and release gates use authored fixtures and the realistic generator profile
at fixed seeds. Weekly/manual adversarial discovery is a separate triage queue,
never a merge or release gate. Keep discoveries issue-linked; exact known
source/output/view pairs are replayed, and stale entries fail. Offline tests
bind entries to current formatter output without needing Docker.

Before implementing a discovered difference, decide whether plausible authored
CommonMark or documented dialect syntax loses meaningful rendered content or
structure. Fix those cases. Record exotic constructions and stray-marker styling
as limits in the design/dialect guides; close them as not planned with
`Status: Won't Do`, reopenable with a report from real use. New findings go
through the general boundary policy before adding a specific protection.

Keep existing fixes and fixtures. Consolidate specific guards only when a
general rule demonstrably replaces them. Finish when the agreed deterministic
gates pass and discovered cases have a disposition. Do not expand a PR for
unrelated optional cases, or try to exhaust adversarial seeds. Use focused local
checks while editing and required final CI; repeat expensive checks only when
changed code or a concrete evidence gap warrants it.

## Benchmarks

`npm run benchmark` times the tool on generated documents; it takes a few
minutes, is not part of `check`, and never fails on a slow result. Run it before
and after a change that could affect speed, on the same idle machine, and
compare as the [benchmarks
page](https://viell-dev.github.io/slop-markdown-tools/benchmarks.html#run-it-and-compare)
explains. The reference results on that page come from the Benchmark workflow on
a GitHub-hosted runner, which runs for pull requests that change `benchmarks/`
and on request (`gh workflow run benchmark.yml --ref <branch>`); replace them
only from such a run.

## Documentation

Assume basic JavaScript/TypeScript and GitHub knowledge. Shared CLI, API,
configuration and rule guidance must be usable without knowing optional
applications such as Obsidian or VitePress. Lead with the general developer's
task, then identify application-specific behavior where it first matters. Give a
short syntax example, local explanation or targeted link when a term needs
context; readers should not need to read the whole guide first. Dedicated
integration pages can address that application's users directly.

Preserve distinctions that affect behavior. For example, the workspace is what
mdrefine scans, while an Obsidian vault is that application's notes folder;
their roots can differ. A glossary can support these explanations but does not
replace clear scope and context in an introduction, option or example.

The site's source is `docs/`, built by VitePress. A user page explains what a
reader needs to use the tool; the details that only maintainers need, such as
lists of individual protections, internal limits, and parser work, go to the
[maintainer
notes](https://github.com/viell-dev/slop-markdown-tools/blob/main/internals/README.md)
in `internals/`, which the site does not build and the package does not ship,
and the page links them by their GitHub address. How the checks run belongs in
the contributor and testing guides, not in the user pages. The tool formats and
lints the repository's own Markdown at 80 columns; Prettier formats everything
else and leaves Markdown alone. The fixtures in `tests/fixtures/` and the
documents of `examples/workspaces/` and `examples/plugin/notes/` are left
unformatted on purpose.

```sh
npm run format:docs        # format the Markdown
npm run format:docs:check  # lint it and check its format without writing
npm run format             # both formatters
npm run docs:dev           # preview the site while editing
npm run docs:build && npm run docs:preview
```

The preview's address includes the `/slop-markdown-tools/` base path. The site
build fails on a link to a page that does not exist, and the tool's lint fails
on a heading fragment that does not. The integration tests compare the examples
page, the rule index and each rule page's facts, and the benchmark page with the
code, and reject version annotations in the pages, so update them with the
behavior they describe. CI builds the site for every pull request. The site
describes the newest stable release: the Pages workflow deploys it from that
release's tag after the Release workflow publishes it, as
[RELEASING.md](https://github.com/viell-dev/slop-markdown-tools/blob/main/RELEASING.md)
describes. A correction to that release's documentation goes to `main` and to
the release's `site-VERSION` branch, which RELEASING.md also describes, so that
the site never describes unreleased behavior. The deployed site's `version.json`
names the commit it was built from. GitHub Pages must use GitHub Actions as its
source.

Keep links usable both in the checkout and in the installed package. A shipped
page links source-only material, such as agent instructions, release procedures
or maintainer guides, by its public GitHub address. Do not expand the package to
include the maintenance tree just to satisfy a link. Update incoming links and
retained redirects when moving a procedure.

The package check reads the installed `README.md`, `CHANGELOG.md`,
`CODE_OF_CONDUCT.md`, `CONTRIBUTING.md` and `SECURITY.md`. Their relative
Markdown links, images and reference definitions must name files in the actual
package. Code examples and deliberate broken-link fixtures are outside this
bounded check. Remote URLs and heading fragments are not verified by it; the
repository lint and site checks retain their own scope.

A page describes the behavior of the version it documents, without version
history: no notes such as "after 0.4.0", "since", "added in", or "unreleased".
The site is built from a release tag, so it never shows unreleased behavior, and
the changelog's `Unreleased` section lists what `main` adds; a page on `main`
describes `main`. History belongs in `CHANGELOG.md` and in the steps of the
[upgrading](docs/upgrading.md) page. The versioning policy, the version a
benchmark measured, and the versions of renderers and other tools are not
history. The docs tests reject version annotations in the other pages outside a
short list of such passages; add to that list only a passage of those kinds.

Each rule has a page, `docs/rules/<category>/<name>.md`, titled with its ID,
which follows one order:

1. One or two plain sentences on what the rule checks or changes, and why it
   matters where that is not obvious.
2. The facts: kind and whether `format` fixes it, each preset with the severity
   it gives the rule, as in "`recommended` (warn)", or "none", the dialects, and
   the options.
3. A short example: before and after, or reported and not reported.
4. The options: a table where there are several, then a point for each.
5. Under the heading "Edge cases and advanced usage", the paragraphs or short
   lists that open with **Details:**, **Not checked:**, **Left as written:**, or
   **Reported without a fix:**.
6. Under "Dialect notes", those that open with a dialect, such as **In
   Obsidian:**, or a link to the dialect page that already says it.
7. Under "Related rules", how the rule works with other rules.

Leave out a heading that would have nothing under it. The common case comes
first: an option's details stay with the options, and what a reader needs only
for unusual input goes under the headings.

The rule index, `docs/rules.md`, has one table per category, in alphabetical
order of rule ID. Each row links the rule's page and gives the description that
the rule's code declares, which `mdrefine rules` prints, its kind, the severity
at which each preset enables it, and whether it takes options. The docs tests
compare the index and each page's facts with the code. The site's sidebar lists
the pages from the directory, and the index forwards a link to a rule's section
of the former single page, such as `rules.html#stylewrap`, to its page.

## Pull requests

Every change to `main` goes through a pull request under the [repository
enforcement](#repository-enforcement) procedure below. Contributions are made
under the MIT license; follow the [code of conduct](CODE_OF_CONDUCT.md).

- Describe the problem, the resulting behavior, and the decisions made and why,
  for a reader who will not read the diff. Link the issue.
- Give the verification: the commands and their results, the platforms, the runs
  of the [renderer
  checks](https://github.com/viell-dev/slop-markdown-tools/blob/main/internals/verification.md#what-the-checks-prove)
  when the change triggers them, and what the evidence cannot show. Record which
  [review](#review-and-verification) the change got.
- A change to formatting needs tests of the expected output, of formatting
  twice, and of preserved meaning; a defect that changes rendering needs a
  minimal regression example.
- Update every document, example, and test that describes what you changed, in
  the same pull request, and add the change to the `Unreleased` section of
  [CHANGELOG.md](CHANGELOG.md). The first change after a release starts that
  section above the newest version's, because a release renames it. Write each
  entry in one or two lines that say what a user will notice, with its issue
  link; the documentation and the issue hold the details. Changes that users do
  not see, such as tests, CI, and internal reorganization, go under
  `### Maintenance`, one line each.
- A change to the command line, the configuration, the JSON report, or the
  library that is not a defect fix waits for the next minor release; see the
  [versioning
  policy](https://viell-dev.github.io/slop-markdown-tools/versions.html).
- Keep changes scoped, and state remaining limits.

## Repository enforcement

`.github/rulesets/` records the policies for `main`, for version tags, and for
the `site-*` branches that correct the current release's site; keep it and
GitHub's settings in sync. Main requires three `verify (OS, NODE)` jobs in
`ci.yml`, where `NODE` is the matrix's major version label rather than its exact
`node-version`, its separate `Unit coverage` job, and the PR-only
`Native checks` aggregate in `native.yml`. All bind to GitHub Actions, app
15368; renaming or adding a required check needs recorded/live ruleset checks,
the producer mapping in `scripts/release-evidence.mjs`, and
`tests/integration/release-evidence.test.ts` kept aligned. The native aggregate
requires successful applicable hosts and explicit inapplicability, as the [check
map](https://github.com/viell-dev/slop-markdown-tools/blob/main/internals/verification.md#what-the-checks-prove)
describes. An applicable external-host outage blocks merge; investigate it
without waiving evidence or weakening the ruleset. The Node.js 26 job is not
required. Zero required approvals is deliberate for a single-account,
agent-maintained repository; PRs, passing checks, and resolved review threads
remain mandatory.

Merge with a merge commit after checking the exact head:
`gh pr merge --merge --match-head-commit SHA`. Squash and rebase merging are
disabled so that each commit keeps its message and attribution. Branches must be
up to date; when `main` advances, merge it into the task branch and validate the
updated head before pushing and merging. GitHub deletes merged PR branches.
Fast-forward local `main` before new work, then prune finished task branches and
stale tracking refs without disturbing active work.

The release procedure owns [exact-commit publication
evidence](https://github.com/viell-dev/slop-markdown-tools/blob/main/RELEASING.md#publish)
and [hosted versus local
preparation](https://github.com/viell-dev/slop-markdown-tools/blob/main/RELEASING.md#prepare-without-publishing).
PR checks may test a synthetic merge tree and cannot substitute for the
release's push/main evidence.

## Review and verification

Every change gets its tests and CI, then the author's review of the complete
diff after the checks pass, trying inputs that the tests do not cover. Beyond
that, the maintainer decides whether a separate agent with fresh context reviews
it, by its sensitivity, complexity, effect, and uncertainty, and records the
choice:

- Ordinary, well-understood changes use author review and relevant checks. A
  substantial parser, engine, file-write, packaging or publication change can
  get one independent review over its coherent change range, shared with the
  release review where practical. Do not repeat review for every small PR or
  re-review unchanged code merely because another commit was added.
- A release PR normally gets an in-depth independent review by a model with
  stronger reasoning suited to the work, of the changes since the previous
  release, unresolved defects, the evidence, compatibility, packaging,
  documentation, and installation and updates, not just the version. Record the
  reason when one is left out.
- The same model or provider may review; prefer a different provider for
  important releases and particularly sensitive work. Name the reviewed commit
  and scope. Address every finding; a material fix or a disputed finding gets a
  focused follow-up review of the unresolved material finding and affected
  changes. Optional cases and wording nits do not start another review round.

A PR's verification section records the commands and their results, the
platforms tested, the runs of the real-renderer checks when its changes trigger
them, what the evidence cannot show, and the review it got. The map of [what the
checks
prove](https://github.com/viell-dev/slop-markdown-tools/blob/main/internals/verification.md#what-the-checks-prove)
says which checks back which promise and when the expensive ones run.
Investigate a failing or intermittent check and fix the product or the check; do
not rerun it until it passes, and do not widen a limit without understanding the
failure.

Documentation review also follows the [audience and applicability
guidance](#documentation). Follow the general developer's reading route to the
common case, then check that application-specific branches establish their
meaning and scope through a local example, explanation or targeted link.

Review bots may provide PR reviews if usage levels allow. Their findings are
claims to verify against the code and, for rendering, the actual renderer. Fix
valid findings with relevant tests; answer each thread with evidence before
resolving it. Bot reviews supplement author and independent review; their quotas
neither replace nor gate those reviews. The ruleset requires resolved threads,
not a bot review.
