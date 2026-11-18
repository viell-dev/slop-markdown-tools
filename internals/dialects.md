# Dialect notes

The [dialects](../docs/dialects.md) page describes what each dialect reads. This
page holds the details of its checks that maintainers need and users do not.

## GitHub heading anchors

GitHub heading anchors also participate in the semantic guard for rule and
plugin edits. Structural HTML can close a generated heading early or carry its
text into later blocks. HTML headings inside table cells also contribute
anchors; ordinary cell boundaries close them, while malformed table HTML can
reorder them. When a boundary is uncertain, the GitHub formatter preserves the
source from the affected heading or table through the end of the document.
Fragment checks retain known earlier headings and explicit HTML IDs; other
fragments are reported as not fully checked, without guessing an anchor. The
CommonMark fallback uses the same fragment-checking limit.

These anchors also account for GitHub's tag filtering: tags such as `script` and
`style` render as text, while the HTML between them can still supply headings
and explicit IDs. Unsupported inline attributes and raw tags such as `<title/x>`
can expose uncertain markup and leave later fragments incomplete. Character
references split by a real HTML tag or comment retain their literal text when
heading IDs are built.

GitHub repository-file checks also select the reading used after YAML front
matter preprocessing. A byte-zero `---` envelope with a mapping, or with a YAML
error display, leaves the body to render normally. Ordinary valid non-mappings
remain Markdown, as do envelopes preceded by a BOM or blank line. Unsupported
YAML scalar classes and unverified boundaries retain only anchors shared by both
readings; other fragments are reported as not fully checked. This target
selection does not change the formatter's front matter safety readings or the
CommonMark fallback.

GitHub file checks also collect anchors from dollar-math source as ordinary
Markdown. A Setext underline can include the dollar lines in its heading, inline
emphasis can affect the heading ID, and HTML anchors or headings inside those
lines can remain reachable. Duplicate IDs follow this complete file reading. The
alternative is made lazily after the front matter choice; formatting and other
dialects keep their existing math readings.

## Forgejo and Gitea

The repository's checks compare the tool's output with disposable Forgejo 17.0.1
and Gitea 28.3.0 instances. Authored fixtures and realistic documents at fixed
seeds are checked through their file-rendering APIs; actual repository file
pages also check heading IDs, explicit targets and fragment links, including
headings inside definition descriptions. The evidence covers those host versions
and default rendering settings. Custom hard-break or math settings, themes and
browser math layout need separate validation. Weekly adversarial generation
discovers limits without becoming a release gate.

`forge-protections.ts` retains initial metadata envelopes not already covered by
a primary YAML node. It scans to the first native separator without changing
`parse.ts` or interpreting YAML. `forge-front-matter.ts` owns the shared scan;
`semantics.ts` includes the exact envelope text or its absence in every forge
fingerprint. This refuses creation, removal and boundary moves by every writer,
including plugins. Selected code values cannot vary it. A selected metadata
value can vary only when the original native closer agrees with the primary YAML
node's end and the replacement retains that boundary; VitePress keeps its
separate projection. Creation fixtures run as forced native controls, including
an explicit Setext option and isolated leading-blank removal, even when output
is unchanged. The matcher follows `isYAMLSeparator`: ASCII spaces, at least
three consecutive dashes, then spaces; tabs are excluded. Non-ASCII Go
whitespace is accepted with the native loop's extra byte step following each
rune (so a leading Unicode space immediately before three dashes fails, while
four pass). Adjacent non-ASCII runes land on an invalid UTF-8 byte and fail.
Physical CRLF lines are recognized because both pinned file renderers read their
metadata, despite the standalone extractor's terminal-CR rejection. Empty closed
regions are conservatively protected; unclosed ones are not. Unit
`forge-protections.test.ts` and the shared `forgeFrontMatterFixtures` cover
output, convergence and native rendering, including scalar and invalid YAML.

Generated stray-marker text can still change emphasis or strikethrough pairing
when wrapping moves markers across quoted lines. The observed case preserves
text and block structure and is tracked as a bounded styling limit in
[#665](https://github.com/viell-dev/slop-markdown-tools/issues/665), reopenable
with meaningful impact on authored input.
