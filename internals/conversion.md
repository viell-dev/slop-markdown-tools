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

`.prettierignore` supports literal paths, `*`, `?`, whole-component `**`, the
same accepted escapes, root anchors, and directory suffixes; braces and
parentheses stay literal. Character classes, trailing whitespace, and negated
entries are reported rather than emitted. Prettier matches ignore patterns
without regard to letter case; converted patterns match case exactly. Conversion
reports this approximation once per `.prettierignore` file.

All subsets reject `.`, `..`, and empty path components, and absolute paths,
including Windows drive and UNC spellings on every platform. A leading `/` in
EditorConfig or `.prettierignore` is a source-root anchor, and a trailing `/` in
`.prettierignore` marks a directory; these are permitted boundaries rather than
empty components. Every emitted pattern is rebased into the destination subtree;
unrepresentable intersections are also reported for manual migration.

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
