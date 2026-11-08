# `links/allowed-notation`

Reports the Markdown link and image forms that its options disallow, such as
reference links or inline links whose text is their URL. `format` rewrites a
disallowed URL-as-text link as an autolink where that is safe. With explicit
`fixTo: "full"`, it can instead convert disallowed inline links and images to
full references.

**Style rule**, fixed by `format`. Presets: none. Dialects: all. Options:
`autolink`, `inline`, `full`, `collapsed`, `shortcut`, `urlInline`, `fixTo`.

With `urlInline: false`, before:

```markdown
[https://example.com](https://example.com)
```

After:

```markdown
<https://example.com>
```

Each option allows its form when `true` and reports it when `false`:

| Option      | Form                                         | Default |
| ----------- | -------------------------------------------- | ------- |
| `autolink`  | `<https://example.com>`                      | `true`  |
| `inline`    | `[text](target)` or `![alt](target)`         | `true`  |
| `full`      | `[text][label]` or `![alt][label]`           | `true`  |
| `collapsed` | `[label][]` or `![label][]`                  | `true`  |
| `shortcut`  | `[label]` or `![label]`                      | `true`  |
| `urlInline` | `[https://example.com](https://example.com)` | `true`  |

`urlInline: false` reports only an inline link whose displayed text equals its
URL; `inline: false` reports all inline links and images.

**Convert inline links to full references.**

Enable conversion explicitly; no preset enables it:

```jsonc
{
  "rules": {
    "links/allowed-notation": ["warn", { "inline": false, "fixTo": "full" }],
  },
}
```

Before:

```markdown
Read [the guide](https://example.com/setup "Setup").
```

After:

```markdown
Read [the guide][mdrefine-link-1].

[mdrefine-link-1]: https://example.com/setup "Setup"
```

`fixTo` accepts only `"full"`, and cannot be combined with `full: false`. It
fixes only disallowed forms: with `inline: true`, ordinary inline links stay as
written. With `urlInline: false`, a disallowed URL-as-text link becomes a full
reference rather than an autolink. Without `fixTo`, the existing autolink fix
and report-only behavior remain.

The label and image alternative-text source are retained, including formatting
and escapes. New definitions share an identical destination and title; an absent
title and an explicit empty title remain distinct. Labels are allocated in
first-use order, avoiding defined labels and generated-looking text anywhere in
the document. Existing definitions are reused only when their label is unique,
already referenced, and their destination and title match. Unused, duplicated
and comment-like definitions are kept and never repurposed.

New definitions are appended in a top-level block at the end of the document.
The whole candidate is reparsed and checked, including existing references and
formerly literal bracketed text. The replacements and insertion apply together
only when suppression, selected ranges and renderer protections permit every
edit. A partial range can convert using an existing definition, but adding a
definition also needs the insertion point within the selected range. An unsafe
conversion remains reported without a fix. This includes multiline destination
or title source, tabs in resource syntax, an end of file inside an unclosed
fence or HTML block, and other contexts whose meaning cannot be proved
unchanged.

Destinations with `javascript:`, `vbscript:`, `file:` or `data:` schemes stay as
written, including data images. Hosts can reject these resources and show their
authored notation as literal text, which conversion would change. Definitions
containing tabs are never reused because reference parsers disagree about
whether they are definitions or visible text. On Forgejo and Gitea, links in
heading source that determines a generated anchor stay inline. All links inside
Obsidian headings stay inline to preserve heading names used by other notes.
Links on callout or alert marker lines also stay inline. Other eligible links
can still convert in the same document.

In Obsidian, only links that reuse an existing, already-used, top-level,
single-line definition can convert. New definitions remain visible in Live
Preview, and reference images are read as internal embeds there, so conversion
keeps other links and all images inline, including sized images
([#908](https://github.com/viell-dev/slop-markdown-tools/issues/908)).

Conversion does not generate collapsed or shortcut references, convert
references back to inline links, or remove, sort or move authored definitions.

## Edge cases and advanced usage

**Details:** references are read by the parser, matching defined labels with
Unicode case folding and collapsed spaces, tabs, and line endings. Undefined
references remain literal text. An inline URL-as-text link becomes an autolink
only when `autolink` is allowed, it has no title, and its source text and
destination are exactly the same unescaped HTTP or HTTPS URL. Fixes use a
conservative ASCII subset: letters, digits, `@%+._~:/?#=-`, without trailing
punctuation or `_-`.

**Reported without an autolink fix:** links with entities, escapes, spaces,
angle brackets, ampersands, parentheses, or formatted labels, which stay as
written, links inside Obsidian headings whose authored source can be a
cross-note destination, and links whose source determines a Forgejo or Gitea
heading anchor or attribute block. The other disallowed forms remain reported
without a fix. Eligible body links still receive autolink fixes; forge headings
with a stable explicit ID can receive them too.

## Related rules

Only `fixTo: "full"` can add reference definitions; none are removed.
[`links/notation`](../links/notation.md) converts verified Obsidian targets
between wikilinks and Markdown and governs wikilinks; bare addresses belong to
[`links/bare-url`](../links/bare-url.md).
