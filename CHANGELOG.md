# Changelog

Notable changes to mdrefine, newest first. The format follows [Keep a
Changelog](https://keepachangelog.com/en/1.1.0/), and version numbers follow the
[versioning
policy](https://viell-dev.github.io/slop-markdown-tools/versions.html). Each
release's section is also its [GitHub
release](https://github.com/viell-dev/slop-markdown-tools/releases)'s notes; the
prereleases' notes there are longer than their entries here.

## Unreleased

### Added

- `style/block-spacing` takes `linesAbove` and `linesBelow`, the blank lines
  that a heading needs above and below it, as one count or one per level, and
  `includeFrontMatter`, which also separates a heading directly below front
  matter. The counts are minimums, and the default stays one blank line. A
  configuration whose counts exceed `style/blank-lines`' `maximum` is refused
  when it is read, instead of leaving the two rules to undo each other
  ([#679](https://github.com/viell-dev/slop-markdown-tools/issues/679)).

- `structure/heading-increment` takes `frontMatterTitle`, with the values of
  `structure/initial-heading`'s, which treats a front-matter title as a level-1
  heading, so that the first heading may be at most level 2. It is off by
  default, because the supported renderers do not show such a title as a heading
  ([#699](https://github.com/viell-dev/slop-markdown-tools/issues/699)).

- Three report-only rules, in no preset, cover markdownlint's MD037, MD038, and
  MD039: `content/emphasis-spacing` reports emphasis or strong markers with
  blank space just inside them, as in `** bold **`, where the parser reads
  emphasis once the spaces are gone; `content/inline-code-spacing` reports blank
  space at the ends of a code span that renderers show as part of the code; and
  `links/text-spacing` reports blank space at the ends of link text. They leave
  alone a single `*` or `_` with spaces on both sides, as in `a * b * c`,
  arithmetic, markers inside words, wildcard patterns such as `*.md *`,
  identifiers, emoji codes, the content of inline HTML elements such as
  `<code>`, JSX comments, and code whose blank space shows syntax or
  indentation, as in `- `, or keeps a backtick apart
  ([#689](https://github.com/viell-dev/slop-markdown-tools/issues/689),
  [#690](https://github.com/viell-dev/slop-markdown-tools/issues/690),
  [#691](https://github.com/viell-dev/slop-markdown-tools/issues/691)).

- Opt-in `content/line-length` reports heading, code and table overflow with
  per-kind limits, switches and display-column measurement
  ([#673](https://github.com/viell-dev/slop-markdown-tools/issues/673)).
- `style/wrap` takes `mode: "never"` to join paragraphs onto one line with the
  same safety protections as wrapping; preset defaults remain unchanged
  ([#711](https://github.com/viell-dev/slop-markdown-tools/issues/711)).

- Opt-in `style/link-title` normalizes link, image, and definition title
  delimiters with `double`, `single`, `parentheses`, and `consistent` choices.
  It retains source escapes and line breaks and never changes destinations
  ([#716](https://github.com/viell-dev/slop-markdown-tools/issues/716)).

- Opt-in `style/definition-spacing` writes one space after a reference
  definition's colon and before its title, also where the colon has none.
  Multiline definitions, tabbed definitions, footnotes, and Obsidian spacing
  stay as written
  ([#717](https://github.com/viell-dev/slop-markdown-tools/issues/717)).

- Opt-in `links/reversed` reports likely reversed links such as
  `(text)[https://example.com]`, without a fix, since a fix would turn text into
  a link. Citations, versions, numbers, call syntax and defined labels are not
  reported
  ([#672](https://github.com/viell-dev/slop-markdown-tools/issues/672)).

- Opt-in `links/bare-url` reports bare URLs and email addresses, and adds angle
  brackets where the dialect already links the address and the brackets keep the
  same link. CommonMark, which shows them as text, is only reported
  ([#686](https://github.com/viell-dev/slop-markdown-tools/issues/686)).

- Opt-in `links/allowed-notation` restricts link and image notations with
  markdownlint's MD054 options, all allowed by default, and turns a title-free
  link whose text is its URL into an autolink where that renders the same
  ([#696](https://github.com/viell-dev/slop-markdown-tools/issues/696)).

- Opt-in `style/no-tabs` reports tabs with `codeBlocks`, `ignoredCodeLanguages`,
  and `spacesPerTab`, replacing safe prose and indentation tabs while keeping
  literal content and Obsidian list nesting
  ([#671](https://github.com/viell-dev/slop-markdown-tools/issues/671)).

- Opt-in `style/prose-space` collapses repeated prose spaces without moving line
  breaks, preserving literal content, indentation and hard breaks
  ([#720](https://github.com/viell-dev/slop-markdown-tools/issues/720)).

- `links/valid` takes `ignoredFragments`, a regular expression for fragments not
  to check, validated when the configuration is read, and `exactCase`, which
  also reports a fragment that reaches its anchor only because the renderer
  ignores letter case. By default fragments still match as each dialect's
  renderer matches them, and anchors are still generated per dialect.
  `Workspace.resolve` returns the anchor's own spelling as `fragmentAnchor`
  ([#705](https://github.com/viell-dev/slop-markdown-tools/issues/705)).

- `links/undefined-reference` takes `shortcutSyntax`, which also reports an
  undefined shortcut reference such as `[label]`, and `ignoredLabels`. Shortcuts
  leave alone task marks, alert and callout markers, Obsidian inline footnotes,
  Forgejo and Gitea shortlinks, inline HTML elements, and URLs written as text,
  delimited as GFM's autolink literals are, besides the existing indexes, code,
  math, and HTML. Both are off by default
  ([#706](https://github.com/viell-dev/slop-markdown-tools/issues/706)).

- `style/trailing-space` takes `hardBreakSpaces` for exact space-style breaks,
  `listItemEmptyLines` to keep blank list-line indentation, and report-only
  `codeBlocks`. `style/thematic-break` accepts any exact break text and follows
  the first exact text with `consistent`. `style/list-indent` takes
  `startIndented` and `startIndent` for first-level indentation. Preset defaults
  stay unchanged; existing protections remain, and the thematic-break protection
  for a compact hyphen line now also covers longer runs such as `-----`
  ([#702](https://github.com/viell-dev/slop-markdown-tools/issues/702),
  [#687](https://github.com/viell-dev/slop-markdown-tools/issues/687),
  [#701](https://github.com/viell-dev/slop-markdown-tools/issues/701)).

- `style/inline-code` writes a code span with the fewest backticks its content
  allows, keeping padding and table cell escapes, and keeps its delimiters where
  a shorter run could pair with an earlier one. `style/code-fence` removes
  spaces and tabs before the info string, keeping metadata and nested fence
  lengths. These extend the existing rules without new options
  ([#714](https://github.com/viell-dev/slop-markdown-tools/issues/714),
  [#715](https://github.com/viell-dev/slop-markdown-tools/issues/715)).

- `style/table` takes `pipeStyle` for explicit, document-consistent, or
  per-table borders, `style: "tight"`, `alignedDelimiter` for header-aligned
  delimiters, and `padding: "alignment"` for padding by column alignment.
  Defaults remain aligned cells with both borders and padding on the right;
  required pipes and renderer protections remain
  ([#708](https://github.com/viell-dev/slop-markdown-tools/issues/708),
  [#709](https://github.com/viell-dev/slop-markdown-tools/issues/709),
  [#719](https://github.com/viell-dev/slop-markdown-tools/issues/719)).

- `links/unused-definition` and `links/empty` take `ignoredDefinitions`, the
  labels of definitions written as comments, which default to `["//"]`.
  `recommended` no longer reports `[//]: # (comment)` while no reference uses
  its label; footnotes are still reported
  ([#707](https://github.com/viell-dev/slop-markdown-tools/issues/707)).

- `style/emphasis` and `style/strong` accept `marker: "consistent"`: the first
  parsed emphasis or strong text chooses its marker for the document. Preset
  defaults stay unchanged
  ([#703](https://github.com/viell-dev/slop-markdown-tools/issues/703),
  [#704](https://github.com/viell-dev/slop-markdown-tools/issues/704)).

- Three report-only rules, in no preset, cover markdownlint's MD026, MD036, and
  MD059 with their options: `structure/heading-punctuation` reports a heading
  that ends with sentence punctuation, `structure/emphasis-heading` a paragraph
  of only emphasized or strong text, and `links/descriptive-text` a link whose
  whole text, such as "here", does not say where it leads. They read headings
  and links as each dialect's renderer shows them, and leave abbreviations,
  ellipses, and emoji shortcodes at the end of a heading alone
  ([#681](https://github.com/viell-dev/slop-markdown-tools/issues/681),
  [#688](https://github.com/viell-dev/slop-markdown-tools/issues/688),
  [#698](https://github.com/viell-dev/slop-markdown-tools/issues/698)).

- Three report-only rules, in no preset, cover markdownlint's MD014, MD018,
  MD020, and MD028: `structure/unspaced-heading` reports text such as `#Heading`
  or `#Heading#` that would be a heading with a space after its hashes,
  `structure/split-quote` a blank line between two block quotes, and
  `content/shell-prompt` a shell code block whose every command starts with a
  `$` or `%` prompt and that shows no output. They leave Obsidian tags, issue
  references such as `#123`, shebangs, and a blank line before an alert or
  callout alone
  ([#674](https://github.com/viell-dev/slop-markdown-tools/issues/674),
  [#675](https://github.com/viell-dev/slop-markdown-tools/issues/675),
  [#677](https://github.com/viell-dev/slop-markdown-tools/issues/677),
  [#683](https://github.com/viell-dev/slop-markdown-tools/issues/683)).

### Fixed

- In Obsidian, rules no longer change a list item that starts on a footnote's
  label line, as in `[^1]: - item`, below a run of three or more backticks that
  nothing closes. Live Preview shows such an item as code carried from the run
  ([#670](https://github.com/viell-dev/slop-markdown-tools/issues/670)).

- Forgejo and Gitea retain native table rows misread as ordered lists, tables
  hidden inside quoted paragraphs, and URL-adjacent backslash hard breaks.
  Shared edit protections cover builtin rules and plugins while leaving
  independent prose editable
  ([#661](https://github.com/viell-dev/slop-markdown-tools/issues/661),
  [#663](https://github.com/viell-dev/slop-markdown-tools/issues/663),
  [#664](https://github.com/viell-dev/slop-markdown-tools/issues/664)).

### Changed

- The documentation describes the behavior of the version it belongs to, without
  version notes; this changelog keeps the history. Each rule section opens with
  what the rule does, then states the severity that each preset gives it, as the
  rule index does
  ([#746](https://github.com/viell-dev/slop-markdown-tools/issues/746)).

- `style/heading` removes heading-owned indentation, including Setext text and
  underlines, while retaining container prefixes. Its new `closing: "add"`
  option writes matching closing hash sequences on ATX headings, including the
  deeper levels of the Setext style. Renderer protections still apply. This
  interface addition belongs to the next minor release
  ([#680](https://github.com/viell-dev/slop-markdown-tools/issues/680),
  [#700](https://github.com/viell-dev/slop-markdown-tools/issues/700)).

- `style/block-spacing` also separates fenced code blocks that have a closing
  fence, and tables, from the blocks around them, as markdownlint's `MD031` and
  `MD058` and Prettier do. Blocks inside list items and footnote definitions
  stay as written, and a table is separated only from blocks that every renderer
  reads as separate from it: text below a table, which GFM reads as another row,
  stays ([#684](https://github.com/viell-dev/slop-markdown-tools/issues/684),
  [#697](https://github.com/viell-dev/slop-markdown-tools/issues/697)).

- `style/heading` writes one space between ATX heading hashes and text,
  including tabs and retained closing sequences. Empty headings need no
  separator. Protected Forgejo and Gitea attribute suffixes stay as written
  ([#676](https://github.com/viell-dev/slop-markdown-tools/issues/676),
  [#678](https://github.com/viell-dev/slop-markdown-tools/issues/678)).

- The [comparison with Prettier and
  markdownlint](https://viell-dev.github.io/slop-markdown-tools/integrations.html#coming-from-prettier-or-markdownlint)
  lists every markdownlint rule and every Prettier Markdown option and
  formatting choice, with the issue that tracks each check not yet covered
  ([#668](https://github.com/viell-dev/slop-markdown-tools/issues/668)).

- Tokenizer identity verification partitions the unchanged deterministic corpus
  into bounded unit cases while retaining every source, selection and assertion
  under the existing deadline
  ([#654](https://github.com/viell-dev/slop-markdown-tools/issues/654)).

- Release evidence selects the latest check-run identity, preserving pending and
  unsuccessful reruns without letting an older completed null-start check hide a
  newer success
  ([#647](https://github.com/viell-dev/slop-markdown-tools/issues/647)).

- The shipped internal protection-source declaration uses its existing point
  type without an undeclared direct type import. Installed package checks cover
  that declaration with npm and strict pnpm; public entry points are unchanged
  ([#655](https://github.com/viell-dev/slop-markdown-tools/issues/655)).

- Maintainer guidance distinguishes intentional first-occurrence fixture
  rewrites from sanitizers, preserving intended bytes when triaging scanner
  alerts ([#643](https://github.com/viell-dev/slop-markdown-tools/issues/643)).

- Workspace memory verification separates document/cache lifecycle checks from a
  fresh compiled-product process's retained-text sample. The existing source
  allowance remains enforced, with numeric failure evidence and opt-in heap
  diagnostics
  ([#413](https://github.com/viell-dev/slop-markdown-tools/issues/413)).

- Filesystem discovery and selection, on-demand related-file lookup, and
  in-place write/recovery now have separate internal owners. Public discovery,
  selection and filesystem safety contracts are preserved
  ([#620](https://github.com/viell-dev/slop-markdown-tools/issues/620)).

- The Obsidian verification harness uses only its service-provided browser and
  ChromeDriver binaries, removing unused automatic-download FTP/PAC and
  `extract-zip` dependencies. Missing or incomplete executables fail explicitly;
  native host downloads, caching and version selection retain their existing
  owners ([#639](https://github.com/viell-dev/slop-markdown-tools/issues/639),
  [#640](https://github.com/viell-dev/slop-markdown-tools/issues/640)).

- Dependency updates follow parser, VitePress/reference and tooling maintenance
  units across dependency declarations. Existing compatibility deferrals remain,
  with explicit revisit checks for peers, tool pins and verified host baselines
  ([#636](https://github.com/viell-dev/slop-markdown-tools/issues/636),
  [#637](https://github.com/viell-dev/slop-markdown-tools/issues/637)).

- Five parser extensions used only to build the bundled parser are development
  dependencies. Installed consumers retain the required runtime utilities and
  public plugin types; package checks cover both parser paths and the shipped
  internal declarations. Release audits include bundled inputs regardless of
  npm's development flag
  ([#624](https://github.com/viell-dev/slop-markdown-tools/issues/624)).

- Maintained internal parser algorithms live in directly checked TypeScript
  source, with source guards and generated provenance linking their rationale,
  ownership and removal conditions to the dependency records. Parser behavior,
  extension compatibility and the bundled license graph are preserved
  ([#622](https://github.com/viell-dev/slop-markdown-tools/issues/622),
  [#623](https://github.com/viell-dev/slop-markdown-tools/issues/623)).

- Test suites separate engine, configuration, plugin, rule and comparison
  responsibilities. Shared parser/CLI support and authored native fixtures have
  explicit ownership, preserving their cases and native workload plans
  ([#634](https://github.com/viell-dev/slop-markdown-tools/issues/634)).

- Internal renderer protections have named collectors and one cached result;
  rule registration and semantic acceptance are separate from engine phase
  orchestration, preserving the public API and formatting behavior
  ([#618](https://github.com/viell-dev/slop-markdown-tools/issues/618),
  [#619](https://github.com/viell-dev/slop-markdown-tools/issues/619)).

- Workflow regression tests check YAML structure while retaining exact evidence
  identities. Contributor and release policy is authoritative; agent navigation
  permits cohesive internal modules, and optional review bots have no guaranteed
  availability
  ([#635](https://github.com/viell-dev/slop-markdown-tools/issues/635),
  [#641](https://github.com/viell-dev/slop-markdown-tools/issues/641),
  [#642](https://github.com/viell-dev/slop-markdown-tools/issues/642)).

- Native renderer reports validate the intended documents, widths, views and
  calibration controls, including unchanged formatting attempts. Obsidian
  PR/release checks pin the app, installer and Docker base and record observed
  runtime/image identity; weekly/manual checks retain explicit latest coverage
  ([#632](https://github.com/viell-dev/slop-markdown-tools/issues/632),
  [#633](https://github.com/viell-dev/slop-markdown-tools/issues/633)).

- Linux 24 CI collects unit and coverage evidence in one required, isolated job.
  Hosted release preparation reuses exact-commit push/main CI results while
  freshly building and testing its publication tarball; local preparation
  retains the complete checks
  ([#628](https://github.com/viell-dev/slop-markdown-tools/issues/628),
  [#629](https://github.com/viell-dev/slop-markdown-tools/issues/629)).

- Builds prepare fresh staged output and reject unexpected packaged files. CI
  and release preparation reuse one verified build within their invocation,
  while standalone commands remain self-contained
  ([#626](https://github.com/viell-dev/slop-markdown-tools/issues/626),
  [#627](https://github.com/viell-dev/slop-markdown-tools/issues/627)).

- Native PR checks classify semantic inputs and resolved dependency roles, avoid
  unnecessary hosts for VitePress-only dependency updates or offline-tool
  changes, and enforce applicable comparisons through one required result.
  Release still compares every native host at its exact commit
  ([#630](https://github.com/viell-dev/slop-markdown-tools/issues/630),
  [#631](https://github.com/viell-dev/slop-markdown-tools/issues/631)).

- Dependency automation also defers the markdown-it 15 lines of
  `@mdit/plugin-container`, `@mdit/plugin-emoji` and `@mdit/plugin-tasklist`
  assessed in [#608](https://github.com/viell-dev/slop-markdown-tools/pull/608),
  [#610](https://github.com/viell-dev/slop-markdown-tools/pull/610) and
  [#611](https://github.com/viell-dev/slop-markdown-tools/pull/611), under the
  same reconsideration conditions as the earlier deferrals.

## 0.5.0 - 2026-10-24

### Changed

- Dependency automation defers the incompatible reference-parser versions
  assessed in [#591](https://github.com/viell-dev/slop-markdown-tools/pull/591)
  through [#594](https://github.com/viell-dev/slop-markdown-tools/pull/594),
  with explicit reconsideration conditions, to prevent repeat incompatible PRs.

- Remove every `mdtools` compatibility form deprecated in 0.4.x: the command,
  all five configuration discovery names and all three suppression-comment
  prefixes. Replace them with `mdrefine` before upgrading; old comments are
  ordinary HTML and old config names are no longer discovered. The migration
  notice and legacy wrapper are removed. Formatting does not migrate user files
  ([#601](https://github.com/viell-dev/slop-markdown-tools/issues/601)).

### Fixed

- Update the indirect `fast-uri` dependency to 3.1.9 for its URI parsing and
  normalization security fixes, and the Docker-only Obsidian check's
  `serialize-javascript` override to 7.1.3 for its serialization security fix.
  The repository lockfile does not ship: existing installations can retain an
  older indirect version. Run `npm update fast-uri` in the consuming project,
  then use `npm ls fast-uri` to verify every resolved copy is 3.1.9 or a newer
  compatible patched release.

- Memory checks settle V8's collectible roots and compilation caches before
  sampling, rather than assuming a regular major collection has released all
  collectible memory. The strict source-retention allowance and negative
  controls remain in place
  ([#413](https://github.com/viell-dev/slop-markdown-tools/issues/413)).

## 0.4.1 - 2026-10-24

### Changed

- Forgejo and Gitea gain automated before/after comparisons against pinned
  official disposable hosts, with realistic fixed-seed corpora and actual
  repository-file heading/fragment controls. PR and release gates use these
  checks; weekly adversarial discovery remains separate
  ([#486](https://github.com/viell-dev/slop-markdown-tools/issues/486)).

- The command, configuration filenames, suppression comments, temporary-file
  prefixes, examples and current documentation now use `mdrefine`. The old
  `mdtools` command, config names and comments remain compatible but deprecated
  throughout 0.4.x and will all be removed in 0.5.0. Rename config files and
  replace comment prefixes manually; formatting does not migrate them. One CLI
  migration notice per run does not count against `--max-warnings`
  ([#600](https://github.com/viell-dev/slop-markdown-tools/issues/600),
  [#601](https://github.com/viell-dev/slop-markdown-tools/issues/601)).

- Obsidian structural rules conservatively keep ambiguous block boundaries as
  written. Proposed style edits held by native-rendering protection now report
  the original rule and severity instead of disappearing silently; safe
  independent formatting remains available
  ([#603](https://github.com/viell-dev/slop-markdown-tools/issues/603)).

- Renderer PR/release gates compare existing fixtures and realistic documents at
  fixed seeds. Fresh adversarial generation becomes weekly/manual discovery with
  exact issue-linked known differences and stale-entry checks. Maintenance and
  review now use bounded scope and proportional verification
  ([#603](https://github.com/viell-dev/slop-markdown-tools/issues/603)).
- A release is published only after CI has passed on its exact commit and
  GitHub, Obsidian, Forgejo and Gitea rendering of fixed documents is unchanged
  by formatting at that commit. Pull requests that change parsing, rules,
  presets, or dependencies run the renderer comparisons. The documentation site
  records the release and commit it was built from in `version.json`, and the
  current release's site can be corrected from a `site-VERSION` branch without a
  new version
  ([#485](https://github.com/viell-dev/slop-markdown-tools/issues/485)).

### Fixed

- Builtin parsers avoid repeated nested-label lookups and batch eligible pairs
  of long emphasis runs. Obsidian also avoids rescanning the same unfinished
  wikilink or embed suffix
  ([#94](https://github.com/viell-dev/slop-markdown-tools/issues/94),
  [#577](https://github.com/viell-dev/slop-markdown-tools/issues/577)).
- Focused Obsidian captures record the observed app and renderer versions
  separately from the requested version, with hashes binding completed evidence
  to its input and executed spec
  ([#580](https://github.com/viell-dev/slop-markdown-tools/issues/580)).
- Obsidian keeps the boundary after standalone comments so that heading/list
  spacing cannot split a native paragraph. Following inline style edits remain
  available
  ([#357](https://github.com/viell-dev/slop-markdown-tools/issues/357)).
- Setext titles directly after standalone Obsidian comments keep their
  underlines, since conversion can turn Reading-view paragraph text into a
  heading. Titles ending in whitespace-separated raw `#` runs also keep their
  Setext form, preserving Live Preview's title text
  ([#383](https://github.com/viell-dev/slop-markdown-tools/issues/383)).
- Obsidian keeps list indentation and number width where a preceding nested list
  affects the painted bullet of a following quoted list. Same-width numbering,
  delimiter preferences and inline styles remain available
  ([#596](https://github.com/viell-dev/slop-markdown-tools/issues/596)).
- Quoted blocks opened after a Tab keep their literal source where Reading view
  reads code instead of the parsed list, heading or paragraph. Blank quote rows
  between consecutive such blocks stay as literal code content too. Independent
  blocks and ordinary space-only quote margins still format
  ([#597](https://github.com/viell-dev/slop-markdown-tools/issues/597)).
- Obsidian keeps the separator before a list directly following another list's
  final secondary paragraph or indented code block, preserving Live Preview's
  paragraph grouping while allowing safe inline and marker preferences
  ([#598](https://github.com/viell-dev/slop-markdown-tools/issues/598)).
- Obsidian preserves list markers and tightness across quote and table
  continuations, literal table rows after list code fences, adjacent Setext
  titles that Reading view still reads as paragraph text across Tab lines, and
  blank lines inside physical list fences hidden by the primary inline parse
  ([#582](https://github.com/viell-dev/slop-markdown-tools/issues/582),
  [#583](https://github.com/viell-dev/slop-markdown-tools/issues/583),
  [#584](https://github.com/viell-dev/slop-markdown-tools/issues/584)).
- Obsidian keeps adjacent display math inside its final list item and retains
  standalone one-line display widgets when wrapping
  ([#586](https://github.com/viell-dev/slop-markdown-tools/issues/586),
  [#587](https://github.com/viell-dev/slop-markdown-tools/issues/587)).
- Protected separator starts also reject plugin insertions and replacements that
  add a blank before the existing line break or remove a quote-only marker,
  while safe terminal inline edits remain available
  ([#590](https://github.com/viell-dev/slop-markdown-tools/issues/590)).
- Rendering comparisons account for omitted terminal line feeds in highlighted
  GitHub code, generated math response IDs inside raw HTML, and invisible
  Reading-view whitespace beside Obsidian display math, retaining exact source
  code, authored attributes, formula content and visible inline spacing
  ([#515](https://github.com/viell-dev/slop-markdown-tools/issues/515),
  [#588](https://github.com/viell-dev/slop-markdown-tools/issues/588),
  [#589](https://github.com/viell-dev/slop-markdown-tools/issues/589)).

- Release-evidence validation runs through linked checkout paths, and the parser
  builder rejects dependencies resolved outside its checkout consistently across
  platforms while accepting valid checkout directory names
  ([#574](https://github.com/viell-dev/slop-markdown-tools/issues/574),
  [#575](https://github.com/viell-dev/slop-markdown-tools/issues/575),
  [#578](https://github.com/viell-dev/slop-markdown-tools/issues/578),
  [#579](https://github.com/viell-dev/slop-markdown-tools/issues/579)).

- Parsing uses a portable internal adapter to reduce repeated copying and
  searching on documents with many containers, inline constructs or unfinished
  labels. Syntax plugins retain the original attention/strikethrough event
  behavior. GFM footnote list items have valid source ranges and read correctly
  as loose or tight
  ([#300](https://github.com/viell-dev/slop-markdown-tools/issues/300),
  [#151](https://github.com/viell-dev/slop-markdown-tools/issues/151),
  [#240](https://github.com/viell-dev/slop-markdown-tools/issues/240),
  [#280](https://github.com/viell-dev/slop-markdown-tools/issues/280),
  [#542](https://github.com/viell-dev/slop-markdown-tools/issues/542)).

- GitHub file-fragment checks include native headings and HTML anchors in
  dollar-math source, with complete Setext title text and correct duplicate
  numbering. The target reading is lazy and preserves the YAML selection and
  formatter's math behavior
  ([#570](https://github.com/viell-dev/slop-markdown-tools/issues/570)).
- GitHub repository-file fragment checks follow YAML preprocessing: mappings and
  YAML error displays render the body after front matter, while ordinary
  non-mappings remain Markdown. Unsettled YAML classes retain only anchors
  shared by both readings, with incomplete checks reported explicitly
  ([#540](https://github.com/viell-dev/slop-markdown-tools/issues/540)).
- GitHub fragment checks and the CommonMark fallback include headings and
  explicit IDs inside tagfiltered HTML, whose outer tags render as text.
  Unsupported inline attributes and raw-text tag spellings remain incomplete
  instead of producing guessed missing fragments
  ([#541](https://github.com/viell-dev/slop-markdown-tools/issues/541)).
- Raw HTML heading fragments retain literal character-reference text split by
  tags or comments, including the numbering of later duplicate headings
  ([#552](https://github.com/viell-dev/slop-markdown-tools/issues/552)).
- Keep two-space hard breaks inside locally paired multiline code spans, which
  GitHub can display as literal text after an unmatched longer backtick run.
  Both wrapping and inline-code joining retain the physical boundary
  ([#335](https://github.com/viell-dev/slop-markdown-tools/issues/335)).
- Preserve GitHub's heading and lazy paragraph boundaries beside dollar display
  math, including compact hyphen lines and Setext titles. Keep thematic-marker,
  heading, spacing and wrap changes from splitting those native boundaries
  ([#336](https://github.com/viell-dev/slop-markdown-tools/issues/336)).
- Keep Obsidian list markers consistent when HTML leaves one parsed list and
  protects a later list's markers, so formatting cannot split one Reading-view
  list by changing only its earlier bullet
  ([#399](https://github.com/viell-dev/slop-markdown-tools/issues/399)).
- Keep one-column Obsidian table source when missing header or delimiter borders
  would turn Live Preview text into a table widget, and carry Reading paragraph
  state across Tab lines when those borders do not form a real table
  ([#568](https://github.com/viell-dev/slop-markdown-tools/issues/568)).
- Keep a list paragraph adjacent to an Obsidian tilde opener whose info contains
  backticks, preserving its Live Preview continuation while allowing safe list
  formatting. When its primary closer opens Live Preview code, conservatively
  preserve the remaining source because later fences can pair differently
  ([#567](https://github.com/viell-dev/slop-markdown-tools/issues/567)).
- Retain Reading paragraph state across Tab lines after a one-column table
  displayed as text, preserving later literal rows while allowing genuine tables
  to format
  ([#398](https://github.com/viell-dev/slop-markdown-tools/issues/398)).
- Keep the physical multiline image description containing backticks in Obsidian
  so wrapping cannot turn displayed source into an embed; safe surrounding
  inline text still formats
  ([#566](https://github.com/viell-dev/slop-markdown-tools/issues/566)).
- Retain short multiline Obsidian code spans and their following inline source
  when Live Preview resets code styling at the physical newline. Earlier text
  and later independent paragraphs can still format
  ([#565](https://github.com/viell-dev/slop-markdown-tools/issues/565)).
- Keep the terminal separator before an Obsidian Tab-only paragraph
  continuation, preserving hard breaks and literal backslashes while allowing
  earlier wrapping and safe whitespace cleanup
  ([#563](https://github.com/viell-dev/slop-markdown-tools/issues/563)).
- Preserve lazy paragraph lines that determine the Live Preview nesting of later
  blocks in an enclosing list item
  ([#376](https://github.com/viell-dev/slop-markdown-tools/issues/376)).
- Retain the separator before an uncertain Obsidian Setext underline when
  trimming it would create or remove a Reading-view hard break
  ([#383](https://github.com/viell-dev/slop-markdown-tools/issues/383)). Also
  retain heading forms around unwrapped leading math and sole image/embed
  titles, preserving Live Preview typography and placement. The host comparison
  now checks inherited math typography too
  ([#569](https://github.com/viell-dev/slop-markdown-tools/issues/569)).
- Preserve the spaces or tabs after a literal backslash when trimming them would
  create a hard line break, avoiding a guarded trailing-space refusal
  ([#560](https://github.com/viell-dev/slop-markdown-tools/issues/560)).
- Keep hard breaks written as a Tab followed by two spaces, preventing silent
  break loss or guarded cleanup refusals while preserving ordinary
  trailing-space cleanup
  ([#562](https://github.com/viell-dev/slop-markdown-tools/issues/562)).
- Obsidian wrapping retains possible comments that cross a blank line, avoiding
  an unsafe-format refusal when wrapping would put their closer alone on a line
  ([#559](https://github.com/viell-dev/slop-markdown-tools/issues/559)).
- Obsidian table formatting keeps a following paragraph from becoming another
  row when its leading-pipe style differs from the header, including alias and
  link-destination pipes. Ordinary table rows and text after a real blank still
  format ([#558](https://github.com/viell-dev/slop-markdown-tools/issues/558)).
- Obsidian wrapping keeps a leading inline comment with the next atom, avoiding
  an unsafe-format refusal when a long link or other atom would leave the
  comment alone on its first line. The rest of the paragraph still wraps
  ([#557](https://github.com/viell-dev/slop-markdown-tools/issues/557)).
- Obsidian formatting preserves literal blocks after root HTML whose nested tags
  remain open, including URL-shaped children. A parent's closer cannot
  prematurely end that protection; balanced, void, and self-closing HTML still
  permit later Markdown formatting. Parsed fences do not close the raw state;
  formatting conservatively retains source across them until the HTML closes
  ([#556](https://github.com/viell-dev/slop-markdown-tools/issues/556)).
- Obsidian formatting keeps thematic breaks below tables from turning their last
  physical line into a literal Live Preview heading, including header-only
  tables. Existing literal headings retain their row text and underline
  ([#553](https://github.com/viell-dev/slop-markdown-tools/issues/553)).
- Obsidian formatting preserves underlined headings displayed after lazy list or
  quote text, retaining the final heading line, its boundaries, and the lazy
  margin when list padding or number width shrinks. Safe inline changes above it
  remain available
  ([#554](https://github.com/viell-dev/slop-markdown-tools/issues/554)).
- Obsidian formatting preserves literal table rows after paragraph-consumed
  footnotes, including HTML, heading, and code endings, adjacent definitions,
  and ambiguous tab separators. Independent footnotes and empty or space-only
  separators still permit table formatting
  ([#549](https://github.com/viell-dev/slop-markdown-tools/issues/549),
  [#551](https://github.com/viell-dev/slop-markdown-tools/issues/551)).
- Obsidian comparisons ignore native table-cell editing controls when a rendered
  preview is available, while retaining table content, styling, code spacing,
  alignment, row counts, links, and nested authored HTML
  ([#550](https://github.com/viell-dev/slop-markdown-tools/issues/550)).
- Obsidian protection searches for backticks only within each text node,
  avoiding repeated scans of the remaining document
  ([#547](https://github.com/viell-dev/slop-markdown-tools/issues/547)).
- Obsidian HTML continuation retains empty container markers before fences and
  protects code opened by the later fence through the end of the note
  ([#548](https://github.com/viell-dev/slop-markdown-tools/issues/548)).
- Obsidian formatting retains both list boundaries around lazy text below a
  list-item heading and keeps top-level HTML source continued through literal
  quote markers
  ([#513](https://github.com/viell-dev/slop-markdown-tools/issues/513),
  [#546](https://github.com/viell-dev/slop-markdown-tools/issues/546)).
- Obsidian comparisons recognize single-character Setext underlines and omit
  unstyled records emptied by existing punctuation normalization, while keeping
  actual heading, paragraph, code, and widget boundaries distinct
  ([#544](https://github.com/viell-dev/slop-markdown-tools/issues/544),
  [#545](https://github.com/viell-dev/slop-markdown-tools/issues/545)).
- Obsidian list formatting retains ordered-list boundaries across a missing
  quote or footnote prefix, and its comparison keeps adjacent headings distinct
  with or without blank separators
  ([#543](https://github.com/viell-dev/slop-markdown-tools/issues/543),
  [#544](https://github.com/viell-dev/slop-markdown-tools/issues/544)).
- GitHub table headers and continued rows take precedence over dollar display
  math, restoring table-column diagnostics and rejecting edits that split those
  rows into math
  ([#504](https://github.com/viell-dev/slop-markdown-tools/issues/504),
  [#534](https://github.com/viell-dev/slop-markdown-tools/issues/534)).
- GitHub formatting preserves source whose structural heading HTML makes its
  anchor boundary uncertain. Fragment checks report that limit instead of
  guessing IDs, and the semantic guard rejects plugin edits that change ordinary
  heading anchors
  ([#498](https://github.com/viell-dev/slop-markdown-tools/issues/498),
  [#535](https://github.com/viell-dev/slop-markdown-tools/issues/535),
  [#536](https://github.com/viell-dev/slop-markdown-tools/issues/536)).
- GitHub fragment checks include HTML headings in Markdown table cells,
  including headings closed by their cell boundary, and report raw-table
  reordering as uncertain
  ([#538](https://github.com/viell-dev/slop-markdown-tools/issues/538),
  [#539](https://github.com/viell-dev/slop-markdown-tools/issues/539)).
- Obsidian formatting keeps non-one ordered continuations after unpiped table
  text as written, and its comparison ignores terminal whitespace on styled
  fence separators while retaining code and internal metadata whitespace
  ([#532](https://github.com/viell-dev/slop-markdown-tools/issues/532),
  [#533](https://github.com/viell-dev/slop-markdown-tools/issues/533)).
- Obsidian formatting preserves code carried into nested quoted lists, task
  checkbox separators, bare HTML-comment markers, fences whose openers remain in
  HTML, and indented code read outside a quote
  ([#524](https://github.com/viell-dev/slop-markdown-tools/issues/524),
  [#525](https://github.com/viell-dev/slop-markdown-tools/issues/525),
  [#526](https://github.com/viell-dev/slop-markdown-tools/issues/526),
  [#529](https://github.com/viell-dev/slop-markdown-tools/issues/529),
  [#530](https://github.com/viell-dev/slop-markdown-tools/issues/530)).
- Renderer comparisons retain empty checkbox widgets and visible hexadecimal
  text, and ignore lone list-paragraph wrappers whose spacing is unchanged in
  Obsidian's default theme
  ([#522](https://github.com/viell-dev/slop-markdown-tools/issues/522),
  [#523](https://github.com/viell-dev/slop-markdown-tools/issues/523),
  [#528](https://github.com/viell-dev/slop-markdown-tools/issues/528)).
- Obsidian formatting preserves adjacent ordered continuations of tab-continued
  text, separate table headers, lazy paragraphs below list headings, multiline
  comment endings, non-one lists below quotes, footnote continuation text
  outside the four-column margin, fences inside HTML after carried inline code,
  and setext text continued across tabs
  ([#510](https://github.com/viell-dev/slop-markdown-tools/issues/510),
  [#511](https://github.com/viell-dev/slop-markdown-tools/issues/511),
  [#513](https://github.com/viell-dev/slop-markdown-tools/issues/513),
  [#516](https://github.com/viell-dev/slop-markdown-tools/issues/516),
  [#517](https://github.com/viell-dev/slop-markdown-tools/issues/517),
  [#518](https://github.com/viell-dev/slop-markdown-tools/issues/518),
  [#519](https://github.com/viell-dev/slop-markdown-tools/issues/519),
  [#520](https://github.com/viell-dev/slop-markdown-tools/issues/520)).
- Renderer comparisons retain task-list delimiter boundaries, ignore incidental
  font styling on separating spaces, and verify GitHub's highlighted code
  against the source before normalizing wrapper and final-line variations
  ([#512](https://github.com/viell-dev/slop-markdown-tools/issues/512),
  [#514](https://github.com/viell-dev/slop-markdown-tools/issues/514),
  [#515](https://github.com/viell-dev/slop-markdown-tools/issues/515)).
- Obsidian formatting preserves the boundaries its views read differently: lists
  around HTML, task fences, multiline setext text, footnote continuation margins
  and separators, callout lists, heading-like table rows, and inline code or
  emphasis carried into quoted lists
  ([#487](https://github.com/viell-dev/slop-markdown-tools/issues/487),
  [#488](https://github.com/viell-dev/slop-markdown-tools/issues/488),
  [#489](https://github.com/viell-dev/slop-markdown-tools/issues/489),
  [#492](https://github.com/viell-dev/slop-markdown-tools/issues/492),
  [#493](https://github.com/viell-dev/slop-markdown-tools/issues/493),
  [#494](https://github.com/viell-dev/slop-markdown-tools/issues/494),
  [#495](https://github.com/viell-dev/slop-markdown-tools/issues/495),
  [#496](https://github.com/viell-dev/slop-markdown-tools/issues/496),
  [#499](https://github.com/viell-dev/slop-markdown-tools/issues/499),
  [#505](https://github.com/viell-dev/slop-markdown-tools/issues/505),
  [#506](https://github.com/viell-dev/slop-markdown-tools/issues/506),
  [#507](https://github.com/viell-dev/slop-markdown-tools/issues/507)).
- The Obsidian comparison finishes and publishes the editor's syntax tree before
  capturing long notes, and ignores empty table source rows that show nothing.
  Real text, embeds, and empty code lines still count
  ([#497](https://github.com/viell-dev/slop-markdown-tools/issues/497),
  [#508](https://github.com/viell-dev/slop-markdown-tools/issues/508)).
- GitHub dollar display fences no longer interrupt an existing paragraph in the
  parser. Formatting preserves dollar lines as paragraph continuations,
  including inside list items and block quotes
  ([#491](https://github.com/viell-dev/slop-markdown-tools/issues/491)).
- The README's opening description and repository About/topics include
  VitePress, matching the released dialect support. Maintenance instructions
  require public descriptions and discovery metadata to be updated with feature
  changes ([#483](https://github.com/viell-dev/slop-markdown-tools/issues/483)).

## 0.4.0 - 2026-10-21

### Added

- A `vitepress` dialect and preset for VitePress 2, with explicit renderer
  options, preservation of attributes and Vue-sensitive whitespace, and static
  page, asset, heading, and include-aware link checks
  ([#430](https://github.com/viell-dev/slop-markdown-tools/issues/430)).
- Opt-in `codeFormatters` route named fenced-code languages to configured
  executables in CLI `format` modes and the async `formatWithCode` Node API.
  Failures retain the affected block, report an operational error, and keep
  other safe edits
  ([#449](https://github.com/viell-dev/slop-markdown-tools/issues/449)).
- Existing heading checks accept title levels, preambles, configurable
  front-matter titles, and duplicate-heading scope; code-language checks accept
  allowed names and strict info strings. Defaults and problem-only behavior
  remain unchanged
  ([#460](https://github.com/viell-dev/slop-markdown-tools/issues/460)).
- The main `mdrefine` entry exports `unifiedDiff`, the same scalable unified
  patch generator that `format --diff` uses, for scripts extending a formatting
  preview ([#321](https://github.com/viell-dev/slop-markdown-tools/issues/321)).

### Changed

- Rule helpers, syntax protections, source locations, and workspace anchor and
  target resolution have separate modules for maintenance
  ([#229](https://github.com/viell-dev/slop-markdown-tools/issues/229)).
- Contributor checks use TypeScript types during source and test linting, and
  integration tests validate CLI JSON before inspecting it
  ([#227](https://github.com/viell-dev/slop-markdown-tools/issues/227)).
- CI publishes unit coverage reports, complexity checks run separately from
  coverage, and CLI tests are grouped by responsibility with bounded integration
  concurrency
  ([#227](https://github.com/viell-dev/slop-markdown-tools/issues/227)).
- Large-input regression checks compare warmed scaling measurements instead of
  requiring fixed execution times, preserving their output assertions
  ([#227](https://github.com/viell-dev/slop-markdown-tools/issues/227)).

### Fixed

- The semantic guard keeps a resolved filename and fragment separate, so `#`
  inside either cannot make a rewrite to another file appear equivalent
  ([#480](https://github.com/viell-dev/slop-markdown-tools/issues/480)).
- Diagnostics at the same source position use the same rule ID order on every
  machine. This also stabilizes plugin edit precedence when the ranges and
  finding positions match
  ([#229](https://github.com/viell-dev/slop-markdown-tools/issues/229)).
- The benchmark guide identifies the parser's repeated list/table transition
  performance limit and links its standalone reproduction
  ([#300](https://github.com/viell-dev/slop-markdown-tools/issues/300)).
- Dependency documentation distinguishes exact direct pins from a consumer's
  resolved indirect dependencies, and explains consumer lockfiles
  ([#472](https://github.com/viell-dev/slop-markdown-tools/issues/472)).

## 0.3.1 - 2026-10-21

### Fixed

- The Prettier coexistence recipe excludes both `.md` and `.markdown` files,
  matching the file types that both tools process
  ([#458](https://github.com/viell-dev/slop-markdown-tools/issues/458)).
- Named suppression enables work after an all-rule disable, without enabling
  other rules or changing configuration
  ([#456](https://github.com/viell-dev/slop-markdown-tools/issues/456)).
- Obsidian links match every path component without regard to case inside
  skipped folders, and report duplicate case variants as ambiguous
  ([#459](https://github.com/viell-dev/slop-markdown-tools/issues/459)).
- Supplied documents and stdin paths obey inherited Git ignore rules even when
  their parent directories do not exist, with repository boundaries and
  negations preserved
  ([#453](https://github.com/viell-dev/slop-markdown-tools/issues/453)).
- The nested-comment complexity check warms both input sizes and measures fresh
  batches, preserving its scaling bound while reducing timing noise
  ([#227](https://github.com/viell-dev/slop-markdown-tools/issues/227)).
- The links memory-regression check waits for asynchronous full collection,
  keeping its existing retained-text allowance
  ([#413](https://github.com/viell-dev/slop-markdown-tools/issues/413)).
- Invalid asynchronous plugin rules report an engine error without leaking a
  rejected return value into the host process; the CLI keeps exit code `2`
  ([#457](https://github.com/viell-dev/slop-markdown-tools/issues/457)).
- Explicit HTML anchors decode character references in attribute values before
  matching fragments, including numeric references and escaped ampersands
  ([#451](https://github.com/viell-dev/slop-markdown-tools/issues/451)).
- Large paragraphs, tables, code spans, plugin finding lists, configuration
  arrays, and Obsidian target searches no longer exceed the JavaScript engine's
  function-argument limit
  ([#454](https://github.com/viell-dev/slop-markdown-tools/issues/454)).
- Discovery applies explicit exclusions to supplied editor buffers, including
  files that do not exist yet, while retaining their text for link checks
  ([#452](https://github.com/viell-dev/slop-markdown-tools/issues/452)).
- Table formatting keeps colon-container boundaries as written, and
  `content/table-columns` stops checking rows at them, preserving site-generator
  containers
  ([#444](https://github.com/viell-dev/slop-markdown-tools/issues/444)).
- Wrapping preserves snippet-import paragraphs and keeps literal `[[toc]]`
  markers off new line starts, preventing VitePress build failures and lost text
  ([#445](https://github.com/viell-dev/slop-markdown-tools/issues/445),
  [#446](https://github.com/viell-dev/slop-markdown-tools/issues/446)).
- The Obsidian check passes large `PROBE` batches through Docker's inherited
  environment, avoiding the Windows process argument limit
  ([#442](https://github.com/viell-dev/slop-markdown-tools/issues/442)).

## 0.3.0 - 2026-10-20

### Changed

- `recommended` enables `style/block-spacing` at `warn`. `lint` reports missing
  blank lines around headings and lists, and `format` inserts them where safe,
  retaining the rule's existing semantic and renderer protections. To keep
  compact spacing, set `"rules": { "style/block-spacing": "off" }`
  ([#427](https://github.com/viell-dev/slop-markdown-tools/pull/427)).

### Fixed

- In the Obsidian dialect, `style/trailing-space` preserves a separator after a
  list marker alone on its line. Before, removing the final separator made Live
  Preview display it as plain text instead of a list item
  ([#441](https://github.com/viell-dev/slop-markdown-tools/issues/441)).
- In the Obsidian dialect, formatting preserves raw source continued after an
  inline HTML opener, and `style/block-spacing` keeps paragraph boundaries
  inside it or an HTML region continued across a whitespace-only line
  ([#435](https://github.com/viell-dev/slop-markdown-tools/issues/435),
  [#439](https://github.com/viell-dev/slop-markdown-tools/issues/439)).
- In the Obsidian dialect, `style/block-spacing` keeps boundaries inside quotes
  that Live Preview reads as inline text, and between a list and an adjacent
  quote or an empty marker and its following text, which Reading view keeps
  inside the item
  ([#436](https://github.com/viell-dev/slop-markdown-tools/issues/436),
  [#437](https://github.com/viell-dev/slop-markdown-tools/issues/437),
  [#438](https://github.com/viell-dev/slop-markdown-tools/issues/438)).
- In the Obsidian dialect, `style/block-spacing` preserves the boundary after an
  underlined heading that a view reads as paragraph text. Before, a new blank
  line split that paragraph after a multiline level-1 or reference-like heading,
  or an underline with trailing space, extra indentation, or a lone `-`
  ([#434](https://github.com/viell-dev/slop-markdown-tools/issues/434)).

## 0.2.7 - 2026-10-20

### Fixed

- In the Obsidian dialect, unfinished code entered after a contained HTML block
  keeps its literal source and original document end. Before, the parser still
  read HTML where Live Preview had entered code, and formatting could change
  literal emphasis markers below it
  ([#432](https://github.com/viell-dev/slop-markdown-tools/pull/432)).
- In the Obsidian dialect, `style/wrap` introduces no reference-like start after
  indentation or quote markers, and preserves existing starts and pending
  destinations. Live Preview hides the destination there, even without a
  definition line class. Complete labels stay on one line, and a label already
  split across lines stays as written, preserving its link styling
  ([#432](https://github.com/viell-dev/slop-markdown-tools/pull/432)).
- In the Obsidian dialect, HTML opened in a list item or quote protects the lazy
  lines outside its parsed container through both views' raw regions, including
  later openers after a void or closed element. Before, rules changed literal
  `*words*` to `_words_`, and an unclosed tag could leave Live Preview reading
  raw source below a blank line
  ([#432](https://github.com/viell-dev/slop-markdown-tools/pull/432)).
- In the Obsidian dialect, `style/wrap` leaves the first paragraph of a quote
  opened on a list item's marker line as written. Before, reflow moved words
  from that line's literal `>` list text into styled quote continuation lines
  ([#432](https://github.com/viell-dev/slop-markdown-tools/pull/432)).
- `style/block-spacing` proposes no blank line inside a paragraph or underlined
  heading in the reading without TOML front matter. Before, separating `1.` and
  `2) b` directly below its closing fence would turn paragraph text into a list;
  the engine refused the unsafe proposal and reported an error
  ([#431](https://github.com/viell-dev/slop-markdown-tools/pull/431)).
- In the Obsidian dialect, the protection for an inline HTML comment that spans
  blocks also starts in headings and table cells. No rule changes the opening
  heading or table through the block holding the closer, or the rest of the note
  without one. Before, heading conversion, table alignment, and wrapping below
  them could change Live Preview's comment and container styling even though
  Reading view stayed the same
  ([#422](https://github.com/viell-dev/slop-markdown-tools/pull/422)).
- In the Obsidian dialect, no rule changes a paragraph line that starts at the
  first column with `[`, a label, and `]:`, or joins it to the line above or
  below it. Live Preview styles such a line as a link reference definition and
  the lines around it as text, where CommonMark reads more of the paragraph.
  Before, `style/wrap` joined `Text` and `[ref]: https://example.com` below it
  into one line, which Live Preview shows as text
  ([#402](https://github.com/viell-dev/slop-markdown-tools/pull/402)).
- In the Obsidian dialect, `style/final-newline` adds no line break to a note
  that ends in a fenced code block without its closing fence, outside a list
  item or block quote. Obsidian's Reading view shows that line break as one
  more, empty line of the code
  ([#412](https://github.com/viell-dev/slop-markdown-tools/pull/412)).
- In the Obsidian dialect, `style/heading` leaves an underlined heading whose
  one line of text starts at the first column with `[`, a label, and `]:` as
  written, as `[ref]: see the page` with `===` below it. Live Preview styles
  that line as a link reference definition and shows no heading, where Reading
  view shows one; written as `# [ref]: see the page`, both views showed a
  heading ([#417](https://github.com/viell-dev/slop-markdown-tools/pull/417)).
- In the Obsidian dialect, no rule changes the block below a line of blank space
  that holds a tab, below a line of paragraph text, unless the block interrupts
  a paragraph. Obsidian's Reading view reads the tab line as more of the
  paragraph, and then a paragraph, table, underlined heading, indented code
  block, definition, or numbered list that does not start at 1 there as more of
  its text, where CommonMark reads blocks of their own. Before, `style/emphasis`
  changed the markers of such a paragraph, which Reading view paired otherwise
  across the join, and `style/table` aligned such a table, which it showed as
  text ([#417](https://github.com/viell-dev/slop-markdown-tools/pull/417)).
- In the Obsidian dialect, when an HTML block directly follows a list, no rule
  changes the markers or indentation that decide whether the list continues
  below it, including lists nested in its last item, or adds a blank line above
  the block. Obsidian's Reading view keeps the HTML block inside the item and
  continues the list below it with every item whose marker matches, where
  CommonMark ends the list at the block. Before, `style/list-marker` gave both
  lists one marker, and Reading view showed one list in place of two
  ([#417](https://github.com/viell-dev/slop-markdown-tools/pull/417)).
- In the Obsidian dialect, no rule changes a note whose opening YAML fence has
  no ordinary closing fence. Live Preview shows the entire note as YAML source,
  including below a malformed `--- text` closer that Reading view accepts.
  Before, the rules formatted it as Markdown, changing that source and moving
  words into or out of YAML comments
  ([#417](https://github.com/viell-dev/slop-markdown-tools/pull/417)).
- In the Obsidian dialect, the protections for blocks that Obsidian reads
  otherwise also apply below TOML front matter, whose `+++` lines it reads as
  paragraph text. Before, `style/table` aligned a table directly below the
  closing fence and `style/emphasis` changed a footnote definition there, both
  of which Obsidian reads as more of that paragraph
  ([#417](https://github.com/viell-dev/slop-markdown-tools/pull/417)).
- In the Obsidian dialect, no rule changes a paragraph with an inline HTML
  comment that ends in another block or has no closer, nor the blocks through
  its closing block or the note's end. Live Preview carries comment styling
  across those blocks and restores quote and list styling only after the
  closer's line. Before, `style/wrap` moved words onto or off that line,
  changing their styling
  ([#417](https://github.com/viell-dev/slop-markdown-tools/pull/417)).
- In the Obsidian dialect, `style/wrap` starts no line at the first column with
  `[`, a label, and `]:`, which Live Preview styles as a link reference
  definition: the word that opens the label stays on the line before it. Before,
  `Some words before the label [a]: tail words after it.` at 30 columns broke
  the line before `[a]:`, and Live Preview showed the new line as a definition
  ([#416](https://github.com/viell-dev/slop-markdown-tools/pull/416)).
- In the Obsidian dialect, `style/wrap` keeps a tag such as `#tag` on the line
  before it in a block quote whose `>` markers are written without a space after
  them, where Live Preview reads a tag directly after the marker as text.
  Before, a reflowed line could start with `>#tag`, and Live Preview no longer
  showed the tag
  ([#416](https://github.com/viell-dev/slop-markdown-tools/pull/416)).
- In the Obsidian dialect, `style/trailing-space` and `style/wrap` leave the
  blank space at the end of a footnote definition's last line as written where a
  paragraph ends the definition, because Reading view shows it before the
  footnote's backreference. Before, `[^1]: Note ` became `[^1]: Note`, and the
  arrow moved against the text
  ([#416](https://github.com/viell-dev/slop-markdown-tools/pull/416)).
- In the Obsidian dialect, `style/wrap` leaves a paragraph as written when a
  continuation line starts with tag-like text directly after a bare block quote
  marker. Before, joining `>a` and `>#tag b` into `>a #tag b` created a tag in
  Live Preview, which had shown plain text
  ([#416](https://github.com/viell-dev/slop-markdown-tools/pull/416)).

## 0.2.6 - 2026-10-19

### Fixed

- In the Forgejo and Gitea dialects, `links/valid` accepts a link to a heading
  that starts a definition description, as `: # Title` below a term does, which
  Forgejo and Gitea give an anchor. Before, it reported the fragment as missing,
  and also a link to a later heading with the same text, which the renderers
  number from that description's heading on
  ([#389](https://github.com/viell-dev/slop-markdown-tools/pull/389)).
- In the Obsidian dialect, `style/heading` and `style/trailing-space` leave an
  underlined heading as written where one of Obsidian's views reads its
  underline as text: Reading view an underline with blank space after it, or
  before it beyond the heading's text, and Live Preview a lone `-`. Before,
  `Title` and `-- ` below it became `## Title`, which Reading view had shown as
  text ([#393](https://github.com/viell-dev/slop-markdown-tools/pull/393)).
- In the Obsidian dialect, no rule joins a lazy line of `=` or `-` in a block
  quote or list item to the text above it, or changes it: Reading view reads it
  as a heading's underline. Before, `style/wrap` joined `> Text` and `=` below
  it into `> Text =`, and the heading was gone
  ([#393](https://github.com/viell-dev/slop-markdown-tools/pull/393)).
- In the Obsidian dialect, no rule changes a list item's paragraph with a lazy
  line, or the blocks after it in the item, which Live Preview reads outside the
  list. Before, `style/wrap` joined the lazy line, and `style/emphasis` changed
  a paragraph that Live Preview showed as code
  ([#393](https://github.com/viell-dev/slop-markdown-tools/pull/393)).
- In the Obsidian dialect, no rule changes a footnote definition directly below
  a line of paragraph text, also one that ends a list item or block quote, nor
  the blank space at the end of that line. Obsidian's Reading view reads the
  definition as more of the paragraph and its indented lines as code, where the
  rules formatted a footnote: `style/emphasis` changed that code
  ([#392](https://github.com/viell-dev/slop-markdown-tools/pull/392)).
- In the Obsidian dialect, no rule changes a paragraph or heading that starts on
  the line below a link reference definition and further right than it. Reading
  view reads such a line as an indented code block, where `style/wrap` and
  `style/emphasis` changed it as text
  ([#392](https://github.com/viell-dev/slop-markdown-tools/pull/392)).
- In the Obsidian dialect, no rule changes a fenced code block that a list item
  or block quote ends before its closing fence, nor anything below it. Obsidian
  reads the lines below as more of the code, and Live Preview pairs the fences
  after it otherwise than CommonMark; `style/wrap` reflowed such a line and so
  added a line to the code
  ([#392](https://github.com/viell-dev/slop-markdown-tools/pull/392)).
- In the Obsidian dialect, no rule changes a table that Obsidian reads
  otherwise: one directly below a line of paragraph text, which Obsidian reads
  as more of the text, a one-column table whose header line does not end with a
  pipe, which it reads as text, and the rows from the first one without a pipe,
  where its table ends. Nor does any rule change a line with a pipe above
  `- | -`, which Reading view reads as a table header. Before, `style/table`
  aligned or wrote pipes into such text, and Obsidian then showed a table, or
  showed a row inside one
  ([#394](https://github.com/viell-dev/slop-markdown-tools/pull/394)).

## 0.2.5 - 2026-10-19

### Fixed

- In the Obsidian dialect, no rule changes a paragraph with a later line that
  Obsidian reads as starting a list item where CommonMark reads text: a number
  other than 1 with text after it, which Live Preview reads as a list item, and
  an empty item such as `*` or `- `, which Reading view reads as one, nor the
  blocks indented below it. Before, `style/wrap` joined such a line into the
  paragraph and `style/heading` wrote `Text` with `- ` below it as `## Text`
  ([#384](https://github.com/viell-dev/slop-markdown-tools/pull/384)).
- In the Obsidian dialect, `style/blank-lines` and `style/trailing-space` leave
  a line of blank space that holds a tab, or that lies directly below an HTML
  block, as written. Obsidian's Reading view reads such a line as more of the
  paragraph or HTML block above it, so emptying or removing it split a
  paragraph, or made a heading below an HTML block render. No rule changes the
  blocks below such a line that Reading view shows as more of the HTML block, up
  to an empty line
  ([#373](https://github.com/viell-dev/slop-markdown-tools/pull/373)).
- In the Obsidian dialect, no rule changes a paragraph, heading, or table cell
  with a backtick that no run of backticks closes, also in a highlight, an
  inline comment, or the text of a link or image. Live Preview shows the text
  after it as code, at least to the end of its line, and Reading view pairs a
  longer run with a later, shorter one, so the rules changed text that Obsidian
  shows as code. After a run of three or more, the blocks that Live Preview
  shows as code below it stay as written too
  ([#374](https://github.com/viell-dev/slop-markdown-tools/pull/374)).
- In the Obsidian dialect, `style/wrap` keeps an inline footnote, `^[…]`, on one
  line, and keeps the lines of a paragraph with one that spans lines. Live
  Preview shows an inline footnote whose text spans lines as Markdown source,
  and the rule broke lines inside it
  ([#371](https://github.com/viell-dev/slop-markdown-tools/pull/371)).
- In the Obsidian dialect, a `%%` comment at the start of a line below a
  paragraph, or one that text follows on the line where it closes, is part of
  the paragraph, as Obsidian reads it. Before, it was read as a block of its
  own, so `style/trailing-space` removed a hard break above it, `style/wrap`
  kept it apart, and no rule saw the text after it. An empty comment, `%%%%`, in
  a paragraph is now a comment too, which Obsidian hides
  ([#370](https://github.com/viell-dev/slop-markdown-tools/pull/370)).
- `obsidian/callout-marker` leaves a marker that Obsidian shows as text, because
  more than one space or a tab separates it from the quote's `>`, as in
  `>  [!NOTE]`. Before, it lowercased the visible text
  ([#372](https://github.com/viell-dev/slop-markdown-tools/pull/372)).
- In the Obsidian dialect, `style/emphasis` and `style/strong` keep the markers
  of a paragraph, heading, or table cell whose text holds a `*` or `_` that is
  not a marker, as in `snake_case` or `5 * 3`. Obsidian's Reading view pairs
  such a character with a later one: after `snake_case and *em*` became
  `snake_case and _em_`, Reading view showed `case and _em` as emphasis
  ([#368](https://github.com/viell-dev/slop-markdown-tools/pull/368)).
- `links/path` with `leadingDot` keeps `./` before a name that starts with a
  dot, such as `./.gitignore` or `./.github/`, and adds it there. Before, it
  took such a path for one that already started with `./` and removed the `./`
  ([#365](https://github.com/viell-dev/slop-markdown-tools/pull/365)).

## 0.2.4 - 2026-10-19

### Fixed

- In the Forgejo and Gitea dialects, no rule changes a definition description
  any more, a line starting with `: ` below its term, or the blocks indented
  below it. Forgejo and Gitea read the description as blocks, where the parser
  reads text: `style/emphasis` changed code in a fenced block there and the
  anchor of a heading, and the list rules moved a list out of the description
  ([#354](https://github.com/viell-dev/slop-markdown-tools/pull/354)).

## 0.2.3 - 2026-10-19

### Fixed

- `style/block-spacing` adds no blank line below a list whose last item ends in
  a fenced code block without its closing fence. Renderers put that line into
  the code, while the parser does not, so the safety check did not see the
  change ([#351](https://github.com/viell-dev/slop-markdown-tools/pull/351)).
- `style/block-spacing` adds no blank line between text that the parser reads as
  an underlined heading in place of a list, at the end of a list item or block
  quote, and text on the line below it. Renderers read that text as more of the
  list item's text, and the blank line split it off
  ([#351](https://github.com/viell-dev/slop-markdown-tools/pull/351)).
- `links/path` and `links/notation` write a `|` in a table cell as `\|`, because
  one that is not escaped ends the cell. Before, `links/path` wrote every
  wikilink it rewrote with a plain `|`, so that it also reported one whose
  destination already had the configured form, and wrote a `|` from a file or
  folder name into a new destination; `links/notation` wrote a plain `|` into a
  new wikilink or Markdown label. The safety check refused those edits, and with
  them all of the rule's other edits in the document. `links/path` now changes
  only a wikilink's destination and keeps the rest as written, also outside
  tables ([#349](https://github.com/viell-dev/slop-markdown-tools/pull/349)).

## 0.2.2 - 2026-10-18

### Fixed

- Formatting leaves a list that the parser reads as text as written, with the
  blocks indented below it and the list after them. The parser reads a list that
  does not start at 1, or an empty item, as text at the start of a list item or
  block quote below a paragraph and after an indented code block, where GitHub
  reads a list. Before, `style/ordered-list` and `style/list-marker` joined the
  next list to it, `style/list-indent` moved a list out of its items,
  `style/emphasis` changed what GitHub shows as code, `style/heading` made a
  heading of it, and `style/block-spacing` made it loose. Every rule's edits in
  such text are now left out, plugins' too. `style/block-spacing` now separates
  text from a list such as `- 1. Step`, which the parser reads as GitHub does
  ([#341](https://github.com/viell-dev/slop-markdown-tools/pull/341)).
- `style/wrap` leaves a paragraph as written when a code span in it continues on
  an indented lazy continuation line, as after `>* ` without a space. Before,
  the safety check refused all of the rule's edits in such a document
  ([#340](https://github.com/viell-dev/slop-markdown-tools/pull/340)).
- `github/alert-marker` no longer capitalizes a marker that GitHub shows as
  text: in a block quote inside another quote or a list, with text after the
  marker on its line, or with nothing below it. Before, the visible text changed
  ([#337](https://github.com/viell-dev/slop-markdown-tools/pull/337)).
- `style/wrap` and `style/inline-code` keep a code span written across lines as
  written when a line inside it ends with a backslash. Where its backticks do
  not pair, as on GitHub after an unpaired longer run, that backslash is a hard
  line break, which joining turned into a literal backslash
  ([#337](https://github.com/viell-dev/slop-markdown-tools/pull/337)).
- `style/thematic-break` no longer writes `---` directly below display math,
  which GitHub builds from a paragraph and read as a heading
  ([#337](https://github.com/viell-dev/slop-markdown-tools/pull/337)).
- Formatting no longer changes what GitHub, Forgejo, Gitea, and Obsidian show
  for the block directly below TOML front matter. They read the front matter's
  lines as a paragraph, which that block can continue or underline as a heading:
  `style/thematic-break` wrote `---` there, which made the front matter a
  heading, and `style/heading` split such a heading in two. The safety check now
  also compares the reading without TOML front matter, and the rules leave such
  a block as written
  ([#338](https://github.com/viell-dev/slop-markdown-tools/pull/338)).

## 0.2.1 - 2026-10-18

### Fixed

- The Obsidian dialect reads strikethrough with two tildes only, as Obsidian
  shows it; `~a~` is text there. Before, `style/emphasis` left emphasis that the
  misread strikethrough covered unchanged
  ([#327](https://github.com/viell-dev/slop-markdown-tools/pull/327)).
- `style/emphasis` and `style/strong` no longer change markers that GitHub reads
  otherwise than the parser: after an earlier emphasis, in `~~b *c~~ d*`, where
  GitHub shows the asterisks as text; next to tildes, in `x~~*b b*~~`, where a
  `_` would be text on GitHub; and in runs of markers that the parser pairs
  otherwise than CommonMark, as in `xab***a* a*y`. Each rewrite changed what
  GitHub showed while the safety check, which uses the parser's reading, saw no
  change ([#327](https://github.com/viell-dev/slop-markdown-tools/pull/327)).

## 0.2.0 - 2026-10-18

The first stable release. It holds everything in the earlier prereleases, and
the changes since `0.2.0-rc.3` listed here. From this release on, npm's `latest`
tag names the newest stable release, and prereleases stay under `rc` and `beta`;
the [versioning
policy](https://viell-dev.github.io/slop-markdown-tools/versions.html) says what
a version number promises.

### Upgrading from a prerelease

From `0.2.0-rc.3`:

- In the Obsidian dialect, `format` no longer breaks lines inside the text of a
  link, and joins link text that is written across lines, also where
  `0.2.0-rc.3` broke it. Notes that `0.2.0-rc.3` formatted change again: run
  `format --write` once after upgrading.
- A document from stdin whose `--stdin-filepath` is ignored is no longer
  processed: `lint -` reports nothing and `format -` prints it unchanged, with a
  warning. In `mdrefine/node`, `discoverWorkspace` no longer selects `documents`
  whose paths are ignored but lists them in `skipped`.

From an earlier prerelease, also read the upgrade notes of
[0.2.0-rc.3](https://github.com/viell-dev/slop-markdown-tools/releases/tag/0.2.0-rc.3).

### Added

- `--no-warn-ignored` leaves out the warning for a file or directory named on
  the command line that the tool skips as ignored, for hooks and scripts that
  pass every changed file. The JSON report still lists it in `skipped`
  ([#311](https://github.com/viell-dev/slop-markdown-tools/pull/311)).

### Fixed

- `format --diff`, which `format` also does for files by default, takes about as
  long as `format --check` when formatting changes lines throughout a long
  document. Before, building the diff took time in proportion to the document's
  length times its changed lines: two minutes for a generated document of 8,000
  wrapped paragraphs that took four seconds to check
  ([#315](https://github.com/viell-dev/slop-markdown-tools/pull/315)).
- A document from stdin whose `--stdin-filepath` the configuration, Git, or
  discovery ignores is left out as a named file is: `lint -` reports nothing,
  `format -` prints the document unchanged, and a warning says why. Before, it
  was linted and formatted, so an editor's format-on-save rewrote a document
  that the configuration says to leave alone. In the library, `documents` that
  ignore rules leave out are no longer selected
  ([#316](https://github.com/viell-dev/slop-markdown-tools/pull/316)).
- Stdin in a workspace root that Git ignores no longer warns that the root's
  files are not processed
  ([#316](https://github.com/viell-dev/slop-markdown-tools/pull/316)).
- In the Obsidian dialect, `style/wrap` keeps the text of a link on one line and
  moves the link whole to the next line where it does not fit, and joins link
  text written across lines. Obsidian's Live Preview shows a link whose text
  spans lines as Markdown source. `0.2.0-rc.3` broke lines inside link text in
  every dialect; elsewhere it still does, as GitHub, Forgejo, and Gitea render
  such links
  ([#312](https://github.com/viell-dev/slop-markdown-tools/pull/312)).
- Lists and block quotes below a first line of `---` or `+++` that no later line
  closes are read as lists and block quotes, as renderers show them. Before, the
  parser read them as paragraphs, and `style/wrap` joined them to the line
  above, which GitHub then showed as text
  ([#309](https://github.com/viell-dev/slop-markdown-tools/pull/309)).
- `style/thematic-break` and `style/heading` with `setext` no longer write a
  line of `---` alone below such a first line of `---`, which made front matter
  of everything between the two lines. The safety check refused every edit of
  the rule in such a document
  ([#309](https://github.com/viell-dev/slop-markdown-tools/pull/309)).

## 0.2.0-rc.3 - 2026-10-18

### Upgrading from a prerelease

From `0.2.0-rc.2`:

- `format --write` refuses a read-only file on every platform, where Linux and
  macOS used to replace it: the file gets an `engine/unwritable-file` error and
  stays unchanged. Make the file writable to format it.
- One document that cannot be read or written, or that a rule was refused or
  failed on, no longer keeps `format --write` from writing the others. Every
  document that formatted is written, that one with the edits that were kept;
  each problem is reported for its own file, and the exit code is still `2`.
  Before, such a document kept every file from being written, and a file that
  failed while the batch was written stopped the run. Pass `--exclude` to leave
  a file alone.
- In the JSON report, `written` lists the files that were written instead of
  being `true` or `false`. A script that tested it as a boolean must test its
  length, because an empty list counts as true in JavaScript.
- A document that starts with a byte order mark gets its findings and edits at
  the right positions; before, it could be refused or get findings in the wrong
  places. In the library, `parse` now returns `document.source` without the
  mark, which the tree's positions already skipped.
- `mdtools-disable-next-line` and line numbers also count a carriage return
  alone as a line ending; before, such a directive could apply to the wrong
  line.
- A file locked by another program on Windows (`EBUSY`) is handled like one that
  may not be read, instead of stopping every command.
- A document that is not UTF-8 text gets an `engine/unreadable-file` error, and
  stdin that is not stops the command with exit code `2`. Before, such text was
  decoded with U+FFFD in place of what was not UTF-8, and `format --write` wrote
  those characters into the file. Save such files as UTF-8.
- `format --write` writes each file into the existing file instead of replacing
  it with a new one, so the file keeps its permissions, owner and group,
  attributes, creation time, and hard links. Before, a replaced file lost what
  Node.js cannot copy: the other names of a hard link kept the old content, and
  on Windows the file's own permissions were dropped, which could let more users
  read it. A crash or power failure during the write can now leave a file
  incomplete; see [what writing
  keeps](https://viell-dev.github.io/slop-markdown-tools/cli.html#what-writing-keeps).
- When a rule's edits would change a document's meaning, `format` keeps the
  other rules' edits, so `--diff` and the library's output show them, and
  reports that rule with `engine/unsafe-format` at the line where the meaning
  would first differ. Before, the whole document was left unchanged. Edits of
  two rules that overlap are applied in turn instead of refusing the document.
- A mistake on the command line, such as an unknown option or command or a
  missing option value, exits with code `2` instead of `1`, the code for
  findings, and so does `mdtools` without a command, which prints the help on
  stderr.
- The text output and the diff name files from the current directory instead of
  the workspace root. The JSON report keeps paths from the root and adds `root`.
- `config explain` names the configuration file `config` instead of `file`, adds
  the document's `path`, and refuses a document outside the workspace. `config`
  no longer accepts `--exclude`, `--json`, `--stdin-filepath`, and
  `--max-warnings`, which did nothing there.
- A rule that throws or returns invalid findings is skipped for that document
  with an `engine/rule-error` error, in `lint` as well, and the exit code is
  `2`. Before, `lint` stopped at the first such rule, and `format` reported it
  as `engine/unsafe-format`. A plugin rule with an invalid definition, such as
  `phase: "Inline"`, stops the command with exit code `2` where it used to be
  ignored, and a rule or preset named like a built-in property of every object,
  such as `toString`, is reported as unknown.
- `recommended` warns about six more problems, listed under Added. A check that
  runs `lint --max-warnings 0` fails on them until the documents are fixed or
  the rules are turned off.
- `recommended` formats more, so `format --check` and `lint` report documents
  that it used to accept until `format --write` runs once. It removes trailing
  spaces, except hard line breaks, and repeated blank lines; writes code fences
  with backticks and thematic breaks as `---`; turns underlined headings into
  `#` headings and removes closing `#` sequences; and aligns tables. To keep a
  form, turn its rule off or set its option, such as
  `"style/heading": ["warn", { "closing": "keep" }]`.
- `.gitignore` files decide as in Git: a deeper file can include again what a
  higher one excludes, and patterns match letter case exactly unless the
  repository's `core.ignorecase` is on, as Git sets it on Windows and macOS.
  Files that were left out before can be linted now, and the reverse.
- Git's other ignore rules apply too: `.gitignore` files above the workspace
  root, `.git/info/exclude`, and the global excludes file, while a file that Git
  tracks is never ignored. With `--root` on a folder of a repository, or with a
  global excludes file, files that were linted before can be left out now, and a
  tracked file that a pattern matches is linted.
- `.markdown` files are documents, and a file named on the command line is read
  as Markdown whatever its name. A hook that passes every changed file should
  pass only the Markdown ones.
- An input that does not exist and contains `*`, `?`, `[`, or `{` is a pattern,
  and is an error only when it matches no document.
- `.npm-cache` is an ordinary directory, linted like any other unless
  `.gitignore` or `ignore` leaves it out.
- `style/wrap` wraps more: across line breaks in links, emphasis, and code
  spans, inside the text of links and emphasis, in the bodies of GitHub,
  Forgejo, and Gitea alerts, and before words such as `--config` or
  `**strong**`. A check that runs `format --check` fails on documents formatted
  by an earlier version until `format --write` runs once.
- In the library, `resolveConfig` takes one options object,
  `{ path, config, plugins, defaultDialect }`, as `lint` and `format` do, so
  their options serve as they are. A call with the four separate arguments of
  the prereleases throws an error that says so.
- `presets`, `builtInRules`, `dialects`, `dialectAliases`, and `configSchema`
  are frozen, and a change to them throws a `TypeError`; change a copy instead.
- In the library's types, `WikiLink`, `ObsidianComment`, and `ObsidianHighlight`
  replace `ObsidianLiteral`, `Rule.schema` is a `JsonSchema` instead of Ajv's
  schema type, and the lists and records in `Config` are read-only: replace a
  list or the `rules` of a configuration instead of changing it in place.
- `format` throws an error that the workspace throws, such as a loader's `EIO`,
  as `lint` does, instead of reporting it as `engine/unsafe-format`.
- A plugin named `engine` is rejected.
- `recommended` formats lists: `*` and `+` bullets become `-`, `1)` becomes
  `1.`, numbers are made consistent, and each item gets one space after its
  marker and no indentation before it. `format --check` fails on lists written
  otherwise until they are formatted or the list rules are turned off.
- `style/wrap` no longer joins the lines of a paragraph that has a line starting
  with `:::`, `{%`, or `{{`, but lines that an earlier version joined stay
  joined: split them again where a site generator reads them by line.
- A document whose front matter would end inside a code block, an HTML block, or
  display math can get `engine/unsafe-format` errors, and exit code `2`, from
  `format`, where the rules used to change it.

From `0.2.0-rc.1` or earlier, also:

- When nothing names a dialect, documents are read as GitHub Markdown, or as
  Obsidian notes inside a vault, where they used to be read as CommonMark. Name
  `"dialect": "commonmark"` to keep the old reading. The library's `lint`,
  `format`, `resolveConfig`, and `createWorkspace` assume `github` as well.
- `$…$` is math only under the conditions of each dialect's renderer; before,
  any text between two `$` signs was. Text that was left alone because of that
  is now wrapped and restyled like other prose.
- A directory that may not be read is skipped with a warning, and a selected
  document that may not be read gets an `engine/unreadable-file` error, where
  both used to stop the command with exit code `2` and no report. An
  `.obsidian/app.json` that cannot be read or is not valid JSON gives a warning,
  and the vault is not wrapped.
- In a vault below the workspace root, Obsidian links resolve from the vault's
  root and reach only its files. A workspace root inside a vault no longer
  counts as the whole vault, so links that the rest of the vault could affect
  are not rewritten.
- A plugin package is resolved as an `import` from the configuration file, with
  the conditions given to Node.js, so a package with both an `import` and a
  `require` entry loads through `import`.
- In the library, a source loader given to `createWorkspace` can be called more
  than once for the same file and must return the same text each time, and one
  that throws `EACCES` or `EPERM` makes the file unreadable instead of stopping
  the run.
- The `lint` summary counts errors and warnings, and messages about paths,
  configuration files, and plugins are worded differently. Exit codes and the
  JSON report keep their meaning.

From every prerelease:

- The command line, the configuration, the JSON report, and the library now
  follow the [versioning
  policy](https://viell-dev.github.io/slop-markdown-tools/versions.html). npm's
  `latest` tag names the newest stable release; release candidates no longer
  move it.

### Added

- `style/list-marker`, `style/ordered-list`, and `style/list-indent`, in
  `recommended`, write bullets as `-` and numbers as `1.` with consistent
  numbering and one space after each marker, and move each item's lines with its
  text. Their options cover markdownlint's MD004, MD007, MD029, and MD030
  ([#275](https://github.com/viell-dev/slop-markdown-tools/pull/275)).
- `--quiet` reports errors only, and `rules` lists the rules of the
  configuration's plugins too, also as JSON with `--json`
  ([#260](https://github.com/viell-dev/slop-markdown-tools/pull/260)).
- The CLI finds `mdtools.config.js` and `mdtools.config.cjs`, `extends` accepts
  a single preset name, and a rule's setting can be its severity alone in a
  list, as in `["warn"]`. The package ships the configuration's JSON Schema as
  `config.schema.json`, which the documentation site serves as well, for editors
  to complete and check configuration files
  ([#261](https://github.com/viell-dev/slop-markdown-tools/pull/261)).
- The library loads with `require()`, exports `mdrefine/package.json`, and has a
  doc comment for every export; the package lists `keywords`
  ([#261](https://github.com/viell-dev/slop-markdown-tools/pull/261)).
- Nine problem rules: `links/undefined-reference`, `links/unused-definition`,
  `links/empty`, `structure/heading-increment`, `content/image-alt`, and
  `content/table-columns` in `recommended`, and the optional
  `content/code-language`, `structure/single-title`, and
  `structure/duplicate-heading`
  ([#237](https://github.com/viell-dev/slop-markdown-tools/pull/237)).
- `style/block-spacing` separates headings and lists from the blocks around them
  with a blank line
  ([#190](https://github.com/viell-dev/slop-markdown-tools/pull/190)).
- Four style rules in `recommended`: `style/code-fence`, `style/thematic-break`,
  `style/blank-lines`, and `style/trailing-space`, with markdownlint's choices
  as options. `style/heading` also removes closing `#` sequences and can write
  underlined headings (options `closing` and `style`), `style/table` can write
  compact tables (option `style`), and both join `recommended`
  ([#267](https://github.com/viell-dev/slop-markdown-tools/pull/267)).
- `lint` and `format` accept `ranges` to work on parts of a document, and
  `format` returns their `scope`
  ([#188](https://github.com/viell-dev/slop-markdown-tools/pull/188),
  [#195](https://github.com/viell-dev/slop-markdown-tools/pull/195)).
- `mdrefine/node` exports `discoverWorkspace()`, the CLI's discovery of files,
  with the example `examples/library/lint-workspace.mjs`
  ([#189](https://github.com/viell-dev/slop-markdown-tools/pull/189)).
- Glob patterns as inputs, such as `mdtools lint "docs/**/*.md"`, expanded by
  the CLI itself on every system
  ([#239](https://github.com/viell-dev/slop-markdown-tools/pull/239)).

### Changed

- A mistake on the command line exits with code `2`, as in ESLint and Prettier
  ([#260](https://github.com/viell-dev/slop-markdown-tools/pull/260)).
- The text output names files from the current directory, and the JSON report
  gives the workspace `root`
  ([#260](https://github.com/viell-dev/slop-markdown-tools/pull/260)).
- `format --check` names the files that would change
  ([#260](https://github.com/viell-dev/slop-markdown-tools/pull/260)).
- The help describes every command and lists only the options that each one
  reads, an unknown dialect gets the list of dialects, `lint --fix` points to
  `format --write`, `config explain` reports `config` and `path` and refuses
  documents outside the workspace, and the `obsidian/strict-line-breaks` message
  speaks to both command-line and library users
  ([#260](https://github.com/viell-dev/slop-markdown-tools/pull/260)).
- Configuration and rule option errors name the setting as it is written, in
  plain words, and list the allowed values, as in
  `"extends[1]" must be a preset name, not 5`; a JSON syntax error gives its
  line and column
  ([#261](https://github.com/viell-dev/slop-markdown-tools/pull/261)).
- `resolveConfig` takes an options object, the exported tables are frozen and
  typed read-only, and the types of Obsidian nodes and rule schemas are their
  own ([#261](https://github.com/viell-dev/slop-markdown-tools/pull/261)).
- `format --write` refuses read-only files on every platform, and reports a file
  that fails with `engine/unwritable-file`
  ([#177](https://github.com/viell-dev/slop-markdown-tools/pull/177)).
- A file locked by another program on Windows counts as one that may not be
  read, in the CLI and in `createWorkspace` loaders
  ([#177](https://github.com/viell-dev/slop-markdown-tools/pull/177)).
- Documents and stdin that are not UTF-8 text are refused instead of being
  damaged, and `createWorkspace` treats a loader error with the code
  `ERR_ENCODING_INVALID_ENCODED_DATA` as an unreadable target
  ([#234](https://github.com/viell-dev/slop-markdown-tools/pull/234)).
- `format --write` writes into the existing file instead of replacing it, so
  that the file keeps its permissions, attributes, owner, creation time, and
  hard links, and writes the original content back when a write fails part way
  ([#234](https://github.com/viell-dev/slop-markdown-tools/pull/234),
  [#255](https://github.com/viell-dev/slop-markdown-tools/pull/255)).
- `format --write` writes every document that formatted, and reports a document
  that could not be read, formatted as configured, or written for its own file;
  the JSON report's `written` lists the files written
  ([#255](https://github.com/viell-dev/slop-markdown-tools/pull/255)).
- The documentation is restructured, with new pages for the rules, dialects,
  integrations, the library API, versions, and this changelog, and the release
  notes come from this file
  ([#238](https://github.com/viell-dev/slop-markdown-tools/pull/238)).
- When one rule's edits would change a document's meaning, `format` leaves out
  only that rule's edits and names the rule and the line, and it applies
  overlapping edits in turn
  ([#241](https://github.com/viell-dev/slop-markdown-tools/pull/241)).
- Plugin rule option schemas are compiled once instead of for every document
  ([#241](https://github.com/viell-dev/slop-markdown-tools/pull/241)).
- Many repeated headings, and many emphases on one line, no longer take time
  that grows with the square of their number on Forgejo and Gitea, and `ignore`
  and `overrides` patterns are compiled once instead of for every path
  ([#273](https://github.com/viell-dev/slop-markdown-tools/pull/273)).
- `.markdown` files are documents and link targets, and a file named on the
  command line is read as Markdown whatever its name
  ([#239](https://github.com/viell-dev/slop-markdown-tools/pull/239)).
- CI tests Node.js 22.12.0, the lowest supported version, where it tested the
  newest Node.js 22, and also tests Node.js 26
  ([#257](https://github.com/viell-dev/slop-markdown-tools/pull/257)).
- The documentation site describes the newest stable release instead of the
  unreleased state of `main`
  ([#257](https://github.com/viell-dev/slop-markdown-tools/pull/257)).
- `style/wrap` reflows a paragraph with a line break inside a link's text, an
  image description, emphasis, strong text, strikethrough, or a code span, and
  can break lines inside the text of links and emphasis
  ([#262](https://github.com/viell-dev/slop-markdown-tools/pull/262)).
- `style/wrap` wraps the body of a GitHub, Forgejo, or Gitea alert below the
  line with its marker, as it does for Obsidian callouts
  ([#262](https://github.com/viell-dev/slop-markdown-tools/pull/262)).
- `style/wrap` reflows a paragraph whose code span goes on in a line that starts
  with spaces or tabs, and joins the span without them, as `style/inline-code`
  does ([#288](https://github.com/viell-dev/slop-markdown-tools/pull/288)).
- `style/wrap` leaves a paragraph as written when one of its lines starts with
  `:::`, `{%`, or `{{`, such as a Docusaurus admonition or a Liquid tag, keeps a
  word that starts with them from starting a line, and keeps a template tag that
  one line holds whole. Site generators read these by line
  ([#298](https://github.com/viell-dev/slop-markdown-tools/pull/298)).
- The plugin example's style rule writes one space after a heading's `#` marks,
  because `style/thematic-break` now does what it did
  ([#267](https://github.com/viell-dev/slop-markdown-tools/pull/267)).

### Fixed

- `style/wrap`, the other rules that leave the line of an alert's or callout's
  marker alone, and the safety check recognize a marker written with an escape
  or a character reference, such as `\[!NOTE]` or `&#91;!TIP]`, which GitHub
  renders as an alert. Before, `style/wrap` joined the body onto such a marker,
  and GitHub showed an ordinary quote
  ([#298](https://github.com/viell-dev/slop-markdown-tools/pull/298)).
- A document whose front matter would end at a `---` or `+++` inside a code
  block, an HTML block, or display math that a line of the front matter opens is
  read with that block, and formatting keeps its meaning both with and without
  the front matter. Before, rules could change the block's content, such as a
  `___` in code into `---`, which GitHub shows
  ([#298](https://github.com/viell-dev/slop-markdown-tools/pull/298)).
- `style/wrap` wraps a paragraph that starts with a linked image, such as a
  badge, unless it opens a block quote. Before, it was left as written, as if it
  started with a callout's marker
  ([#298](https://github.com/viell-dev/slop-markdown-tools/pull/298)).
- A plugin rule's option schema of `false` refuses options, and an asynchronous
  schema (`$async`) is refused when the rule set is built instead of crashing
  Node.js after the run
  ([#297](https://github.com/viell-dev/slop-markdown-tools/pull/297)).
- A heading whose code span is written across lines gets the anchor that GitHub
  gives it, so a correct link to it is no longer reported missing, and the
  library's `textContent` reads such a code span as renderers show it
  ([#293](https://github.com/viell-dev/slop-markdown-tools/pull/293)).
- `--dialect` works with an `.mjs` configuration that exports a frozen object
  ([#260](https://github.com/viell-dev/slop-markdown-tools/pull/260)).
- `--stdin-filepath` accepts a document inside a root that is reached through a
  link or a Windows junction
  ([#260](https://github.com/viell-dev/slop-markdown-tools/pull/260)).
- The configuration and command-line pages say that configuration patterns match
  letter case on every system, while `.gitignore` files and input patterns
  ignore it on Windows and macOS
  ([#261](https://github.com/viell-dev/slop-markdown-tools/pull/261)).
- `format` stops on an error of the workspace, as `lint` does, instead of
  reporting it as `engine/unsafe-format`, and a plugin named `engine`, whose
  findings would pass for the engine's own, is rejected
  ([#261](https://github.com/viell-dev/slop-markdown-tools/pull/261)).
- `parse` reads a document in the dialect that an alias such as `codeberg`
  stands for, so Forgejo's rules apply to it, and the type declarations no
  longer need `@types/mdast` from another package, which a strict installation
  such as pnpm's does not provide
  ([#261](https://github.com/viell-dev/slop-markdown-tools/pull/261)).
- Documents and JSON configuration files that start with a byte order mark are
  read correctly
  ([#174](https://github.com/viell-dev/slop-markdown-tools/pull/174)).
- `style/heading` keeps link reference definitions directly above an underlined
  heading, which it used to replace with the heading, so that the document was
  refused ([#267](https://github.com/viell-dev/slop-markdown-tools/pull/267)).
- `style/final-newline` adds no line ending, and `style/block-spacing` no blank
  line, where it would become part of an unclosed HTML or Obsidian comment, and
  `style/final-newline` none where it would add a line to a code block without
  its closing fence; such documents used to be refused
  ([#267](https://github.com/viell-dev/slop-markdown-tools/pull/267)).
- `style/wrap` leaves paragraphs as written instead of refusing the document
  when their first word is a bare block marker
  ([#196](https://github.com/viell-dev/slop-markdown-tools/pull/196)), when an
  Obsidian paragraph holds `==`, `[[`, or `]]` outside its highlights and links,
  or when the first line is lazy
  ([#200](https://github.com/viell-dev/slop-markdown-tools/pull/200)).
- `style/wrap` lets words that only start like a block marker, such as
  `--config`, `#tag`, or `-5`, begin a line, and keeps a table delimiter row
  from beginning one
  ([#262](https://github.com/viell-dev/slop-markdown-tools/pull/262)).
- `style/wrap` keeps a paragraph's first line from becoming a link reference
  definition, a thematic break, or display math instead of refusing the document
  ([#262](https://github.com/viell-dev/slop-markdown-tools/pull/262)).
- `style/wrap` counts a tab in a list item's prefix up to the next tab stop
  instead of as no width
  ([#262](https://github.com/viell-dev/slop-markdown-tools/pull/262)).
- A carriage return alone ends a line for suppression directives, diagnostic
  positions, callout titles, and `style/wrap`
  ([#196](https://github.com/viell-dev/slop-markdown-tools/pull/196),
  [#200](https://github.com/viell-dev/slop-markdown-tools/pull/200)).
- A rule that throws or returns invalid findings is reported as
  `engine/rule-error` for its document, and invalid plugin rules and names such
  as `toString` are rejected with a clear message
  ([#241](https://github.com/viell-dev/slop-markdown-tools/pull/241)).
- `.gitignore` files are applied as Git applies them, with negations in deeper
  files and letter case per platform
  ([#239](https://github.com/viell-dev/slop-markdown-tools/pull/239)).
- Git's ignore rules apply from the repository's top level, also above the
  workspace root, together with `.git/info/exclude` and the global excludes
  file. Inside a nested repository only its own rules apply, and none applies to
  a file that Git tracks
  ([#273](https://github.com/viell-dev/slop-markdown-tools/pull/273)).
- Git's ignore rules match letter case as each repository's `core.ignorecase`
  says, and each repository, also a nested one, uses the global excludes file
  that its own settings name
  ([#287](https://github.com/viell-dev/slop-markdown-tools/pull/287)).
- A file or directory named on the command line that is ignored gets a warning
  that says why, instead of being skipped without a word
  ([#239](https://github.com/viell-dev/slop-markdown-tools/pull/239)).
- A link into `dist`, `coverage`, `node_modules`, or another directory that is
  not processed, or through a symbolic link or junction, is checked on disk
  instead of being reported missing; one that leads outside the workspace root
  cannot be checked
  ([#259](https://github.com/viell-dev/slop-markdown-tools/pull/259)).
- An Obsidian block identifier counts only at the end of a block and holds
  letters, digits, and hyphens, in every rule that reads one
  ([#259](https://github.com/viell-dev/slop-markdown-tools/pull/259)).
- A vault's `.obsidian/app.json` that starts with a byte order mark is read
  ([#259](https://github.com/viell-dev/slop-markdown-tools/pull/259)).
- `links/notation` decodes percent escapes when it makes a wikilink
  ([#259](https://github.com/viell-dev/slop-markdown-tools/pull/259)).
- A link to a file that is not Markdown accepts any fragment, such as an image's
  `#gh-dark-mode-only` or a PDF's `#page=2`
  ([#259](https://github.com/viell-dev/slop-markdown-tools/pull/259)).
- An Obsidian wikilink never resolves to a folder
  ([#259](https://github.com/viell-dev/slop-markdown-tools/pull/259)).
- Obsidian links to a heading below another, `[[Note#Setup#Mobile]]`, are
  resolved ([#259](https://github.com/viell-dev/slop-markdown-tools/pull/259)).
- An Obsidian heading link matches the heading's source text, with its
  backticks, as well as its visible text
  ([#259](https://github.com/viell-dev/slop-markdown-tools/pull/259)).
- `style/emphasis` and `style/strong` leave the text of a collapsed or shortcut
  reference, such as `[*Title*][]`, as written, because that text is also the
  label that matches the definition, and likewise text in brackets that the new
  markers would make match one. Before, all of the rule's edits in the document
  were refused
  ([#274](https://github.com/viell-dev/slop-markdown-tools/pull/274)).
- `style/emphasis`, `style/strong`, `style/inline-code`, and
  `style/block-spacing` no longer propose edits that change the parse in rare
  places, where their edits were refused: crossed or shared markers, as in
  `*a _b* c_` or `*****a***`, markers next to dollar math or across the line of
  a callout's or alert's marker, code spans whose joined line would form an
  Obsidian highlight or wikilink, change that line, or pair with earlier
  backticks, a table below one that ends in a list item or block quote, and a
  list in a quote that ends in an empty footnote definition
  ([#274](https://github.com/viell-dev/slop-markdown-tools/pull/274)).
- `style/inline-code` leaves out the spaces and tabs that start a code span's
  next line when it joins the span, as CommonMark and GitHub do; before,
  `npm run` continued by an indented `build` became `npm run    build`, which
  changed what GitHub shows. The safety check compares code spans the same way
  ([#274](https://github.com/viell-dev/slop-markdown-tools/pull/274)).
- `style/inline-code` and the safety check read a code span as GitHub shows it
  where a line break is at its edge, and on a lazy continuation line, one
  without its block quote's `>` or its list item's indentation, whose spaces and
  tabs GitHub keeps in the span. Before, the rule could change what GitHub
  shows, such as `npm run    build` into `npm run build`, and the safety check
  did not notice. Outside the GitHub dialect, a span on such an indented lazy
  line stays split, because commonmark.js leaves those spaces out. `style/wrap`
  now also reflows a paragraph whose code span has a line break at its edge
  ([#291](https://github.com/viell-dev/slop-markdown-tools/pull/291)).
- `style/wrap` keeps a dollar from the edge of a line where it could begin or
  end math there: in Obsidian a word that ends in `$` stays with the word after
  it, and on GitHub and in Obsidian a word that starts with `$` stays with the
  word before it. Before, such a paragraph was refused in Obsidian
  ([#274](https://github.com/viell-dev/slop-markdown-tools/pull/274)).
- `style/wrap` leaves a paragraph as written when its second line is a table
  delimiter row, in every dialect with tables. Directly below a table that ends
  in a list item or block quote, the parser reads another table as such a
  paragraph, and joining its lines removed a table that GitHub shows
  ([#274](https://github.com/viell-dev/slop-markdown-tools/pull/274)).
- `style/wrap` keeps a run of `=` or `-` that starts the body of an alert or
  callout together with the next word. Alone on a line, it would underline the
  marker's line as a heading, and the paragraph was refused
  ([#274](https://github.com/viell-dev/slop-markdown-tools/pull/274)).
- The type declaration of `defaultDialect` describes vaults anywhere in a
  workspace ([#184](https://github.com/viell-dev/slop-markdown-tools/pull/184)),
  and the CLI guide explains stdin in PowerShell
  ([#182](https://github.com/viell-dev/slop-markdown-tools/pull/182)).

## 0.2.0-rc.2 - 2026-10-06

When nothing names a dialect, GitHub Markdown is assumed, or the Obsidian
dialect inside a vault. Vaults are recognized anywhere in a workspace, and their
links resolve within them. Directories and files that may not be read no longer
stop a run. `$` math follows each renderer. Plugin packages resolve like an
`import`. Messages are clearer, link checks need about half the memory, and the
package ships examples. [Release
notes](https://github.com/viell-dev/slop-markdown-tools/releases/tag/0.2.0-rc.2).

## 0.2.0-rc.1 - 2026-10-03

New `forgejo` and `gitea` dialects and presets, with `codeberg` as another name
for `forgejo`. Fragments are checked against the anchors that each renderer
generates, Forgejo and Gitea heading attributes are preserved, and
`forgejo/heading-id` reports ids that break rendering. [Release
notes](https://github.com/viell-dev/slop-markdown-tools/releases/tag/0.2.0-rc.1).

## 0.1.0-rc.1 - 2026-09-21

Five built-in rules no longer propose edits that made formatting refuse ordinary
documents. Obsidian links match without regard to case, new line breaks follow a
document's first line ending, and applying many edits takes linear time.
[Release
notes](https://github.com/viell-dev/slop-markdown-tools/releases/tag/0.1.0-rc.1).

## 0.1.0-beta.4 - 2026-09-18

`style/wrap` wraps an Obsidian callout's body directly below its title, and
reports a long title with `reportUnbreakable`. [Release
notes](https://github.com/viell-dev/slop-markdown-tools/releases/tag/0.1.0-beta.4).

## 0.1.0-beta.3 - 2026-09-18

`style/wrap`'s report options tell breakable prose from unbreakable atoms, and
formatting is more than twice as fast. [Release
notes](https://github.com/viell-dev/slop-markdown-tools/releases/tag/0.1.0-beta.3).

## 0.1.0-beta.2 - 2026-09-18

New `style/inline-code` and `structure/initial-heading` rules, the `measure`,
`reportUnreflowed`, and `reportUnbreakable` options of `style/wrap`, the
`resolve` settings, and `--exclude`. Link resolution fixes, and workspaces with
source loaders. [Release
notes](https://github.com/viell-dev/slop-markdown-tools/releases/tag/0.1.0-beta.2).

## 0.1.0-beta.1 - 2026-09-18

The first public release: `lint` and `format` for CommonMark, GitHub Markdown,
and Obsidian, with presets, overrides, suppression comments, plugins, and link
checks. [Release
notes](https://github.com/viell-dev/slop-markdown-tools/releases/tag/0.1.0-beta.1).
