# `links/bare-url`

Reports bare HTTP and HTTPS URLs, `www.` addresses, and email addresses in
prose. `format` writes them as autolinks, in angle brackets, where that keeps
the same text and destination.

**Style rule**, fixed by `format`. Presets: none. Dialects: all. Options: none.

Before, in GitHub:

```markdown
See https://example.com.
```

After:

```markdown
See <https://example.com>.
```

## Edge cases and advanced usage

**Details:** CommonMark shows bare addresses as text, so the rule only reports
there; GitHub, Forgejo, Gitea, Obsidian, and the VitePress projection already
link literal addresses. Fixes bracket only the exact parsed literal extent, with
unchanged text and destination, using the conservative character subset of
[`links/allowed-notation`](../links/allowed-notation.md). Trailing punctuation
excluded from a literal link stays outside the brackets.

**Not checked:** code, math, HTML, front matter, authored links and images,
definitions (including a definition followed by an HTML comment), and
angle-delimited addresses, including attempts with spaces.

**Reported without a fix:**

- Addresses outside the conservative subset, including `www.` addresses whose
  displayed text differs from their destination.
- An address directly after a backslash or `<`, or directly before `>`: adjacent
  source characters can escape or combine with the new brackets.
- An address in a heading, in Obsidian, which accepts source heading names, and
  in Forgejo and Gitea, which support versions with source-based heading IDs.
  GitHub builds anchors from rendered heading text and VitePress uses inline
  token content; bracketing these exact literal links preserves both, so
  headings remain fixable in those two dialects.

## Dialect notes

**In VitePress:** addresses next to a preceding letter, digit, `_` or `+`, a
following `_` or `~`, or ending in `#`, `%` or `@` are also left as written: its
linkifier can read these boundaries differently from the literal-link parser.
