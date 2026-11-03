# Configuration conversion notes

The [integration
guide](../docs/integrations.md#configuration-conversion-and-fallback) describes
what `config convert` and the fallback carry over from markdownlint and
Prettier. This page holds the details of patterns and comments that maintainers
need.

## Patterns

Pattern conversion is bounded by source dialect. Prettier overrides,
EditorConfig sections, and markdownlint-cli2 globs support literal paths, `*`,
`?`, and whole-component `**`. Brace alternatives must be flat comma lists,
without nesting, empty alternatives, ranges, or `**` inside. Accepted escapes
are backslash followed by another backslash or one of `#`, `?`, `!`, `*`, `[`,
`]`, `{`, `}`, `(`, `)`, `+`, or `@`. Other escapes, character classes,
unescaped parentheses, quoted patterns, and whole-pattern complements are
reported with their source and pattern for manual migration rather than emitted.
Prettier brace patterns also retain their literal spelling, and terminal `/**`
also matches the file before that suffix. CLI2 negative globs are directory
exclusions, and their descendants are expanded before rebasing. When several
CLI2 positive globs need a combined selection, a literal comma outside braces or
a brace alternative cannot be represented in that union: the selection is
reported and omitted. A single positive glob keeps its ordinary meaning.

`.prettierignore` and a participating CLI1 `.markdownlintignore` support literal
paths, `*`, `?`, whole-component `**`, the same accepted escapes, root anchors,
and directory suffixes; braces and parentheses stay literal. Character classes,
trailing whitespace, and negated entries are reported rather than emitted.
Prettier and CLI1 match ignore patterns without regard to letter case; converted
patterns match case exactly. Conversion reports this approximation once per
ignore file. An initial UTF-8 byte-order mark is discarded before interpreting
the first line; other characters remain intact. The same translation handles
both sources independently: negation disables only its own file during fallback,
and an unreadable participating file is an error. A discovered CLI2
configuration keeps its own selection and leaves the legacy ignore file unused;
an ignore file alone does not activate the markdownlint fallback.

All subsets reject `.`, `..`, and empty path components, and absolute paths,
including Windows drive and UNC spellings on every platform. A leading `/` in
EditorConfig or either ignore file is a source-root anchor, and a trailing `/`
in an ignore file marks a directory; these are permitted boundaries rather than
empty components. Every emitted pattern is rebased into the destination subtree;
unrepresentable intersections are also reported for manual migration.

Overlapping EditorConfig sections accumulate their raw values before deriving
Prettier options. Intersections retain exact paths from brace alternatives and
globstar alignments independently. Literal components are compared directly or
tested against a glob; glob components intersect when equal or when one is `*`.
Different fixed terminal ASCII extensions prove a component pair disjoint. The
proof compares extensions without regard to ASCII letter case while emitted
patterns keep their source case; case-only extension differences stay unproven.
An unsupported component comparison omits that branch and marks the
source-pattern pair incomplete; its other exact intersections remain. The report
keeps a manual-migration notice for incomplete pairs and for an intersection
that cannot be processed.

All rebased alternatives of one section emit their raw values before its
intersections. Intersections follow the previous resolved states' order, moving
an updated scope to the end so a sibling alternative cannot overwrite inherited
values in an exact intersection.

## Comments during the fallback

Each rule retains its enabled competitor origins outside the configuration.
Disabling a markdownlint check leaves Prettier's choice active at warning
severity, using Prettier's own options in that region. Stated markdownlint
options still win where both sources are active. Each distinct set of active
checks is converted with Prettier's choices and the same file override patches.
The engine evaluates each distinct rule setting once per inspection and selects
its findings in the corresponding regions. This also recalculates dependent
options: disabling MD022 restores MD012's own blank-line maximum.

Shared destinations attribute findings to their source checks: `style/heading`
(MD003, MD019, MD021, MD023), `style/list-indent` (MD005, MD007, MD030), and
`style/table` (MD055, MD060). Table rows and list operations retain active check
diagnostics even when the construct starts in a suppressed region.
`style/block-spacing` (MD022, MD031, MD032, MD058) attributes findings to their
named block, and `structure/unspaced-heading` (MD018, MD020) distinguishes
ordinary and closed ATX candidates. A combined edit is withheld when it needs a
suppressed check; active diagnostics remain. For every rule, an edit crossing
regions is accepted only when each region proposes the same replacement and
authorizes its checks. This can leave a whole table or list as written when a
partial repair is unavailable. Every proposal still passes the ordinary edit and
semantic safety checks.

Additional MD022 reports at native-protected heading boundaries have no edit and
no independent Prettier origin. They still use the active rule variant,
markdownlint suppression and comment-aware blank-line counts. Native spacing
keeps list tightness and comment attachment; compatibility reports the source
requirement without making an unsafe edit.

MD041 recognizes a complete single-line leading HTML tag without reparsing.
Other HTML flow uses the bundled parser with markdownlint's GFM, stock math and
block-directive syntax, with HTML flow and indented code disabled. Inline
directives stay off. The compiler captures the first inline HTML token before
image labels collapse their children into alt text; a finished-tree walk would
lose those tags. Code, math and directive attributes keep their token
boundaries. This reading only selects a compatibility diagnostic; it does not
change native syntax or formatting. The original flow's position locates the
report, and each scanned flow is read once.

The fast path reads only the first physical line. Multiline raw tags can cross
paragraph interruptions and differ from the first inline token; they use the
bounded reader. A complete multiline tag returned as an actual inline token
still counts. Blank lines elsewhere in a single-line opener's flow do not
disable its fast path. Nested directive containers can repeatedly tokenize their
bodies. Each compatibility reading wraps its own flow constructs and counts
their consumed codes, including rolled-back reads, with a budget of the greater
of 4096 or 16 times the source's UTF-16 length. Exhaustion aborts that reading
with a dedicated error caught only by identity. It becomes an ordinary MD041
diagnostic with no edit, retaining markdownlint suppression and reporting that
inspection could not complete. Other exceptions still surface as engine
failures.

This bounds the newly exposed directive work
([#858](https://github.com/viell-dev/slop-markdown-tools/issues/858)), rather
than all parser work. This known grammar also uses the builtin deep-list
corrections
([#859](https://github.com/viell-dev/slop-markdown-tools/issues/859)); they do
not replace the directive budget or provide a general parser bound. Remove or
revise the workaround only after an upstream or local parser change passes the
nesting regression, ordinary directive controls and reference comparisons.
