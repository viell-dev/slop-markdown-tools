# `style/link-title`

Writes the titles of inline links, images, and link reference definitions with
one kind of delimiter, double quotes by default. Destinations, including angle
brackets and balanced parentheses, stay byte for byte as written. It is an
optional source style, so no preset enables it and default formatting stays the
same.

**Style rule**, fixed by `format`. Presets: none. Dialects: all. Options:
`delimiter`.

Before:

```markdown
[guide](guide(v2).md 'Guide') ![map](<map.png> (Map))
```

After:

```markdown
[guide](guide(v2).md "Guide") ![map](<map.png> "Map")
```

| Option      | Values                                          | Default  |
| ----------- | ----------------------------------------------- | -------- |
| `delimiter` | `double`, `single`, `parentheses`, `consistent` | `double` |

- `delimiter`: `double` uses double quotes, `single` single quotes, and
  `parentheses` parentheses. `consistent` follows the first parsed title in the
  document, so an existing document keeps its convention. Double quotes are the
  default because they match the usual Markdown title notation. Empty titles
  follow the same choice.

## Edge cases and advanced usage

**Left as written:**

- a title's delimiters, when the preferred delimiter occurs unescaped inside it,
  rather than adding escapes;
- escapes, entities, backslashes, and line breaks inside a title;
- a definition containing a tab, because commonmark.js reads a tab-separated
  definition as text where GitHub and markdown-it read a definition.

**Not checked:** wikilinks and Obsidian embeds, which have no titles.

## Dialect notes

**On Forgejo and Gitea:** a title in a heading stays as written where its source
contributes to the heading's anchor or attribute block.
