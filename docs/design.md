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
rules. Literal autolinks come from the syntax extension only; the GFM tree
transform that re-scanned text for URLs used looser boundaries than GitHub and
produced nodes without source positions.

Forgejo documents parse as GitHub Markdown. Forgejo-only syntax is protected
rather than modeled: paragraphs containing a definition description line or a
`\[` display-math line are not reflowed, `\(...\)` math and `[[...]]` shortlinks
on one line are unbreakable atoms, and a pair split across lines protects its
paragraph because reflow could join it. Shortlinks are not resolved as links.
Legacy `> **Note**` callouts, table-of-contents front matter, emoji
shortcodes, color previews, and issue or commit references are preserved
unchanged and not modeled. Table alignment currently applies only to top-level tables
and preserves cell contents. Embedded code formatting, metadata mutation,
document generation, external URL fetching, and file renames are outside this
release.

Obsidian links resolve against indexed paths, extensionless Markdown candidates,
and unique suffixes for internal links. Duplicate candidates remain ambiguous.
Heading fragments use exact text; GitHub uses slugged headings including
duplicate suffixes, and Forgejo uses its own anchor algorithm, which collapses
punctuation runs and keeps Unicode letters. Block identifiers are indexed from
trailing text markers. Heading nesting paths, property aliases, PDF subpaths,
and every Obsidian plugin's syntax are not fully supported. Embeds are preserved
as embeds; image dimensions in their aliases remain intact.

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
