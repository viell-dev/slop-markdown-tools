# Design and current limitations

## Architecture

The project uses TypeScript, Node.js, and npm. mdast/micromark provide parsing and syntax
extensions. The formatter retains original source and applies source-positioned edits rather than
serializing the whole AST. This allows disabled formatting rules and opaque constructs to retain
their spelling.

`src/syntax/` owns parsing and Obsidian tokens. `src/config/` owns configuration and plugin
discovery. `src/core/` owns the shared contracts, suppression directives, diagnostics, and edit
engine. `src/rules/` implements built-in rules. `src/workspace/` resolves targets and handles
filesystem selection/writes. `src/cli/` connects those services; the public `src/index.ts` library
has no implicit filesystem access.

Lint and format use the same rule settings. A style rule checks a preferred representation and
proposes edits. A problem rule reports defects without inventing repairs. Inline, block, and
document phases separate operations that would otherwise commonly overlap. Each phase reparses its
result and compares a semantic fingerprint, using resolved destinations for link identity.
Formatting must converge; otherwise the original document is returned with an error diagnostic.

## Safety boundaries

The semantic fingerprint protects the supported AST model, not every application's rendered output.
It normalizes ordinary prose whitespace and known callout-marker casing. It does not run Obsidian or
GitHub's renderer. Syntax extensions require regression tests for their own meaning and source
preservation. Tests use synthetic documents, deterministic property checks, and filesystem/CLI
integration cases, including the list-collapse failure that motivated replacing heuristic reflow.

Obsidian callout headers remain intact; their body paragraphs can reflow when supported. Highlight,
comment, math, code, HTML, and front-matter contents are preserved. Standalone Obsidian comment
blocks may span blank lines. Inline comments spanning multiple paragraphs are not fully modeled;
suppress formatting around those constructs or use standalone comment blocks.

The source-preserving wrapper supports ordinary paragraphs, list items, and blockquote containers.
It preserves explicit hard-break paragraphs, lazy/unusual continuations it cannot safely
reconstruct, and paragraphs carrying block IDs. Long unbreakable atoms can exceed the width.
Intraword emphasis retains asterisks when underscores would change parsing. Formatting width is a
target, not a license to split protected syntax.

GitHub alert support normalizes known alert type markers. Footnotes, math, strikethrough, and
autolinks are parsed, but do not each have dedicated style rules. Table alignment currently applies
only to top-level tables and preserves cell contents. Embedded code formatting, metadata mutation,
document generation, external URL fetching, and file renames are outside this release.

Obsidian links resolve against indexed paths, extensionless Markdown candidates, and unique suffixes
for internal links. Duplicate candidates remain ambiguous. Heading fragments use exact text; GitHub
uses slugged headings including duplicate suffixes. Block identifiers are indexed from trailing text
markers. Heading nesting paths, property aliases, PDF subpaths, and every Obsidian plugin's syntax
are not fully supported. Embeds are preserved as embeds; image dimensions in their aliases remain
intact.

All eligible Markdown is currently parsed into an in-memory workspace index. There is no persistent
cache, watch service, editor extension, or language server yet. Use directory selection to scope
output; indexing still needs the containing workspace for cross-document links. The library has a
pluggable workspace interface for specialized hosts.

## Maintenance priorities

Prioritize reproducible document corruption and renderer disagreement over new style options. Add a
minimal regression case before a fix; verify that disabling the affected rule preserves the source.
Broaden dialect fixtures and resolver compatibility before promising complete application parity.
Benchmark real synthetic vault sizes before adding caching or worker processes.

Future changes can add richer link policies, reference-definition formatting, more container layout,
versioned plugin contracts, and optional standalone distribution. Each should extend the shared
configuration and edit contracts instead of creating a second formatter pipeline.

🤖 Generated with GPT-6 via Codex
