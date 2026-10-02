# Design and current limitations

## Architecture

The project uses TypeScript, Node.js, and npm. mdast/micromark provide parsing
and syntax extensions. The formatter retains original source and applies
source-positioned edits rather than serializing the whole AST. This allows
disabled formatting rules and opaque constructs to retain their spelling.

`src/syntax/` owns parsing and Obsidian tokens. `src/config/` owns configuration
and plugin discovery. `src/core/` owns the shared contracts, suppression
directives, diagnostics, and edit engine. `src/rules/` implements built-in
rules. `src/workspace/` resolves targets and handles filesystem
selection/writes. `src/cli/` connects those services; the public `src/index.ts`
library has no implicit filesystem access.

Lint and format use the same rule settings. A style rule checks a preferred
representation and proposes edits. A problem rule reports defects without
inventing repairs. Inline, block, and document phases separate operations that
would otherwise commonly overlap. Each phase reparses its result and compares a
semantic fingerprint, using resolved destinations for link identity. Formatting
must converge; otherwise the original document is returned with an error
diagnostic.

## Safety boundaries

The semantic fingerprint protects the supported AST model, not every
application's rendered output. It normalizes ordinary prose whitespace and known
callout-marker casing. It does not run Obsidian or GitHub's renderer. Syntax
extensions require regression tests for their own meaning and source
preservation. Tests use synthetic documents, deterministic property checks, and
filesystem/CLI integration cases, including the list-collapse failure that
motivated replacing heuristic reflow.

Obsidian callout headers remain intact; supported body prose can reflow directly
below the header or in later paragraphs. The semantic fingerprint also protects
the title/body boundary. Lazy quote continuations and inline syntax spanning
that boundary remain untouched. Highlight, comment, math, code, HTML, and
front-matter contents are preserved. Standalone Obsidian comment blocks may span
blank lines. Inline comments spanning multiple paragraphs are not fully modeled;
suppress formatting around those constructs or use standalone comment blocks.

The source-preserving wrapper supports ordinary paragraphs, list items, and
blockquote containers. It preserves explicit hard-break paragraphs, lazy/unusual
continuations it cannot safely reconstruct, and paragraphs carrying block IDs.
Long unbreakable atoms can exceed the width. Intraword emphasis retains
asterisks when underscores would change parsing. Formatting width is a target,
not a license to split protected syntax.

GitHub alert support normalizes known alert type markers. Footnotes, math,
strikethrough, and autolinks are parsed, but do not each have dedicated style
rules. Literal autolinks come from the syntax extension only. GitHub applies a
second, transform-time autolink pass to files, which links cases such as
`[www.example.com]`, but the GFM tree transform implementing it produces nodes
without source positions, and one such URL made the engine refuse the whole
document. No built-in rule acts on literal autolinks, so formatted output is the
same either way; plugins inspecting link nodes do not see those autolinks.

Forgejo and Gitea documents parse as GitHub Markdown. Their additional syntax is
protected rather than modeled: paragraphs containing a definition description
line or a `\[` display-math line are not reflowed, `\(...\)` math and `[[...]]`
shortlinks on one line are unbreakable atoms, and a pair split across lines
protects its paragraph because reflow could join it. Emphasis markers inside a
one-line `\(...\)` pair are not changed, and code spans are not joined where
that would put `\(` and `\)` on one line. Gitea parses the backslash math
delimiters only when its instance enables them, so they are protected
regardless. Gitea's exception for underscores before `.py` is protected the same
way: on a line containing `_.py`, emphasis markers, multiline code spans, and
link destinations whose rewrite would change their underscores are left
unchanged, and such a paragraph is reflowed only when all its underscores are
inside code spans and it contains no `$` or `\(` math. Shortlinks are not
resolved as links. Legacy `> **Note**` callouts, table-of-contents front matter,
emoji shortcodes, color previews, and issue or commit references are preserved
unchanged and not modeled. Table alignment currently applies only to top-level
tables and preserves cell contents. Embedded code formatting, metadata mutation,
document generation, external URL fetching, and file renames are outside this
release.

A Forgejo or Gitea heading's trailing attribute block (`## Title {#id .class}`)
is protected from formatting, because both renderers read it before they parse
inline content. Whether a heading ends in a valid block, and what the block
says, depends on every character from the first `{` of the heading's last text
line on, so emphasis markers and link destinations from there on are left
unchanged. A code span spanning lines of a heading is not joined, because the
block is read from the heading's last text line. A Setext heading converted to
ATX gets a `#` run in front of its block escaped, which would otherwise close
the heading. For these two dialects the semantic fingerprint includes each
block's source text, so an edit from any other rule or plugin that changes a
block, makes one invalid, or creates one is refused. That covers a block
followed by a closing `#` sequence (`## Title {#id} ##`) as well, which only
Gitea before 1.26 reads as attributes. Forgejo, and Gitea before 1.26, also
generate the anchor from that line as written, so the marker and link
destination rules leave the last line of a heading without a custom `id`
unchanged on these dialects, and the fingerprint includes the Forgejo and Gitea
anchors generated from it.

Obsidian links resolve against indexed paths, extensionless Markdown candidates,
and unique suffixes for internal links. Duplicate candidates remain ambiguous.
Heading fragments use exact text; GitHub uses slugged headings including
duplicate suffixes, and Forgejo uses its own anchor algorithm, which collapses
punctuation runs and keeps Unicode letters. Gitea deletes punctuation like
GitHub but also drops combining marks; Gitea fragments also accept the duplicate
suffixes that versions before 1.26 generated and, for headings containing
`_.py`, the anchor of the literal text that 1.26 and later show. Inline HTML in
a heading contributes its text, but not its tags or comments, to GitHub anchors,
except for the tags that GitHub's tag filter shows as text, such as `<script>`.
Forgejo, and Gitea before 1.26, build anchors from the source of the heading's
last line, with link destinations, emphasis markers, character references, and
tags included and `#` sequences, container prefixes, and a trailing attribute
block left out; Gitea 1.26 and later use the rendered text of every line, so
Gitea fragments accept both. Character references inside a filtered tag on
GitHub are not modeled. Nor, on Gitea, are tags or Markdown syntax inside
`<script>`, `<textarea>`, and the other elements whose content HTML reads as
plain text, including an unclosed one, which takes in the rest of the document.
Forgejo and Gitea fragments read a heading's trailing attribute block
(`## Title {#id .class}`) by the rules of goldmark 1.8, which Forgejo 16 and
Gitea 1.26 and later use: an `id` is the heading's only anchor, matched as
written and never numbered, and any other valid block is left out of the text
that generates the anchor. That text comes from a second parse of the target
with the blocks blanked out, because goldmark removes a block before it parses
the heading's inline content. The block stays heading text for other dialects,
rules, and plugins. An `id` written with the `user-content-` prefix that the
renderers add themselves is matched without it. Not modeled are the older
attribute rules of Gitea before 1.26, which for example also read a block
followed by a closing `#` sequence, and attribute values nested more than 64
levels deep, which leave the block as heading text. A heading whose `id` is not
a string (`{id=5}`) has no anchor on Gitea 1.26 and later and makes Forgejo, and
Gitea before 1.26, render nothing for the document; `forgejo/heading-id` reports
it on both dialects, and the anchors are those of Gitea 1.26 and later. Block
identifiers are indexed from trailing text markers. Heading nesting paths,
property aliases, PDF subpaths, and every Obsidian plugin's syntax are not fully
supported. Embeds are preserved as embeds; image dimensions in their aliases
remain intact.

GitHub, Forgejo, and Gitea store every anchor with the prefix `user-content-`
and add it to a link's fragment unless the fragment already starts with it. A
fragment written with the prefix therefore reaches the same anchor as one
without, and is matched without it; Obsidian fragments stay literal.

The workspace indexes eligible paths first and parses target Markdown only when
a fragment is checked, caching the result for that invocation. CLI discovery
also defers reading Markdown until it is selected or needed for a fragment.
Built-in rule-schema validators are reused across documents. A suffix lookup
index is built on first use instead of scanning every path for each shortened
link. There is no persistent cache, worker pool, watch service, editor
extension, or language server yet. The library has a pluggable workspace
interface for specialized hosts.

Run `npm run build` and `node scripts/benchmark.mjs 1000` for a reproducible
synthetic library benchmark. It reports path-index construction and lint time
separately for 1,000 short interlinked notes; pass a different count to scale
it. `node scripts/benchmark-vault.mjs 2000` times parsing, fingerprinting,
linting, formatting, and re-formatting for a vault of longer interlinked notes
that all need reflow and marker changes, and prints a result hash for comparing
implementations. These timings exclude filesystem traversal and do not predict a
particular vault's throughput. Measure the original workload before adding
caches or workers.

Formatting retains the current parsed document within one call, reusing it
between phases and for final diagnostics. Every changed candidate is parsed and
checked against the original semantic fingerprint before becoming the next
phase's input; the original fingerprint is computed only once an edit produces a
candidate. The final pass, in which no phase changes the document, reuses its
style findings and runs only the remaining rules for the final diagnostics.
Suppression directives are scanned only when the source contains their prefix,
and rules traverse the tree with a plain recursive walk rather than a
closure-per-node visitor. No-op edits still undergo range and overlap
validation. This retains the plugin contract that rules must not mutate
documents.

Run `node scripts/benchmark-format.mjs 100` after building to compare 100
formatting calls on a synthetic 4.8 KB note needing edits with 100 calls on its
already-formatted output. It warms both cases, checks output and diagnostics,
and prints a result hash for comparing implementations. Run several times
without competing workloads; timings exclude discovery, I/O, CLI serialization,
and custom plugins.

## Maintenance priorities

Prioritize reproducible document corruption and renderer disagreement over new
style options. Add a minimal regression case before a fix; verify that disabling
the affected rule preserves the source. Broaden dialect fixtures and resolver
compatibility before promising complete application parity. Benchmark real
synthetic vault sizes before adding caching or worker processes.

Future changes can add richer link policies, reference-definition formatting,
more container layout, versioned plugin contracts, and optional standalone
distribution. Each should extend the shared configuration and edit contracts
instead of creating a second formatter pipeline.
