# Audit source navigation

A documentation repository can have valid individual links while a page, or a
group of pages linking to each other, is unreachable from its README. The
reachability audit follows source navigation from entry pages you name and
reports eligible Markdown documents it cannot reach.

```sh
npx mdrefine audit reachability --entry README.md
```

This command only reports. It never changes a document, deletes a file, inserts
navigation or runs configured code formatters. An unreachable finding is a
navigation observation, not evidence that a document is obsolete. Ordinary
`lint`, `format` and their presets do not run this audit.

## Entries and scope

The command audits the whole [workspace](cli.md#the-workspace-root), using its
configuration, ignore rules and each document's dialect. It does not accept a
partial file selection or stdin. Supply at least one `--entry`; README is not
assumed. Entries are file paths relative to the workspace root, even when you
run from a subdirectory. They must be existing, eligible Markdown files, not
directories, ignored files, symlinks or reporting exclusions. Duplicate entries
are combined. Multiple entries make their combined navigation reachable:

```sh
npx mdrefine audit reachability --root . --entry README.md --entry docs/index.md --json
```

The common `--root`, `--config`, `--dialect` and `--no-competitor-config`
options work as for `lint`, before or after `reachability`. `--exclude <path>`
is repeatable and excludes an exact file or directory from findings. These paths
count from the current directory, as for `lint`. The Node API's paths count from
its explicit root instead.

Git/config ignores, generated-file exclusions and `--exclude` control which
documents can be findings. A specifically linked, readable Markdown file can
still serve as a bridge to another page when configuration ignores or
`--exclude` leave it out of reporting. Git-ignored files are link targets only
with `resolve.gitIgnored: true`. Traversal stops at symlinks, junctions and
nested repositories, even when ordinary link resolution can name a file there.
Such a stop makes the audit incomplete.

## What counts as navigation

The source graph includes Markdown links, used reference links, supported
wikilinks and Markdown embeds. Reference links use the first definition for
their label. A footnote's links count only when the footnote is referenced.
Markdown code spans and fenced or indented code blocks, comments, unused
reference/footnote definitions, ordinary images and attachments do not create
document edges. A link with a bad heading fragment still reaches its known
document; `links/valid` checks fragments separately. Wikilink display labels do
not change their targets.

Targets resolve in the source document's dialect, including VitePress's modeled
page paths and Obsidian's note-name lookup. The target document is parsed in its
own configured dialect. No landing page is guessed for a directory, and
ambiguous note names and unsupported YAML property aliases are not guessed.

The audit uses mdrefine's source reading, with its documented parser and
[dialect limits](design.md#limits). External URLs are not fetched or followed.
Website sidebars, route configuration, search and backlinks are outside this
graph. Use a site generator's own validation for generated navigation, or
provide its document entry pages explicitly. A finding does not claim that a
page is undiscoverable by every means.

## Incomplete audits

Unreadable directories or documents, invalid UTF-8, unresolved local links,
uncertain name lookup and traversal boundaries can hide edges. Local raw HTML
links, embedded HTML and Markdown-looking text inside raw HTML, VitePress
includes and custom/foreign elements or dynamic attributes, links inside
Obsidian highlights, and syntax plugins can also add navigation this audit does
not model. These are coverage problems, rather than proof of unreachability. The
first version conservatively treats a coverage problem anywhere in the scanned
documents as making the whole audit incomplete, including in a disconnected
document. Rule-only plugins do not by themselves create a coverage problem.

VitePress links with `target` or `download` attributes bypass normal page-path
rewriting, so local destinations there also produce a coverage problem when
attributes are enabled. External destinations remain outside the graph.

Run against an unchanged workspace. Files are read during execution, not from an
atomic filesystem snapshot; rerun after concurrent edits.

An incomplete report explains its problems, preserves the documents known to be
reachable, withholds all definitive unreachable findings, and exits with code 2.
It never presents missing evidence as a successful clean audit.

## Reports and exit codes

Text output gives the entries, eligible document count and unreachable paths.
Coverage problems go to stderr. With `--json`, one report goes to stdout:

| Field             | Meaning                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| `version`, `mode` | Package version and `"audit-reachability"`.                                                            |
| `root`            | Absolute workspace root, with symlinks in the root itself resolved.                                    |
| `entries`         | Explicit entry paths, deduplicated and sorted.                                                         |
| `documents`       | Eligible documents after ignores and reporting exclusions.                                             |
| `scanned`         | Documents read and parsed, including excluded transit pages.                                           |
| `reachable`       | Eligible documents reached through known edges.                                                        |
| `unreachable`     | Eligible documents not reached; always empty when incomplete.                                          |
| `complete`        | Whether the audit could establish its modeled source graph.                                            |
| `problems`        | Coverage problems with `path`, `code`, `message`, and when applicable `destination`, `line`, `column`. |

Document paths use forward slashes relative to `root`. Path lists are sorted in
UTF-16 code-unit order. Problem codes are `discovery`, `unreadable`, `boundary`,
`unresolved-link` and `unsupported-navigation`; locations count lines and UTF-16
columns from 1. Invalid entries/configuration or unexpected run failures can
stop the command before a JSON report is available.

| Exit code | Meaning                                            |
| --------- | -------------------------------------------------- |
| `0`       | Complete audit, no unreachable documents.          |
| `1`       | Complete audit, at least one unreachable document. |
| `2`       | Invalid input, incomplete audit or run failure.    |

The [shipped example](examples.md#audit-a-documentation-graph) demonstrates a
disconnected cycle and multiple entries. The same audit is available through the
[Node API](api.md#audit-workspace-navigation).
