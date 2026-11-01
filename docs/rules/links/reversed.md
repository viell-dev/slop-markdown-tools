# `links/reversed`

Reports likely reversed links such as `(text)[https://example.com]`. Fixing one
would turn literal text into a link, so there is no automatic repair.

**Problem rule**, reported only. Presets: none. Dialects: all. Options: none.

Reported:

```markdown
See (the guide)[./guide.md].
```

Not reported:

```markdown
See (the guide)[guide].

[guide]: ./guide.md
```

## Edge cases and advanced usage

**Details:** the bracketed part must contain no whitespace or brackets and look
like a destination: a scheme followed by `://`, `mailto:`, an email-like
address, a slash anywhere, a leading `#`, or a final dot extension of one to ten
ASCII letters or digits, starting with a letter (optionally followed by a query
or fragment).

**Not checked:**

- A parenthesis immediately after an identifier character (a Unicode letter,
  number or combining mark, `_`, or `$`), which is call or subscript syntax, as
  in `f(x)[i.j]`.
- Defined labels, matched with the renderer's Unicode case folding and
  whitespace normalization.
- Citations such as `(Smith 2020)[1]`, cross-references such as
  `(see above)[note]`, versions such as `(see)[v1.2]`, and numeric references
  such as `(see)[p.12]` and `(1, 2)[0.5]`.
- Footnotes, wikilinks, task markers, code, math, HTML, text inside authored
  links and destinations, and parentheses inside a bare URL, such as
  `https://example.com/(a)[b.md]`.
