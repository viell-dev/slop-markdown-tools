# `style/no-tabs`

Reports tab characters and replaces tabs in prose with spaces. Leading
indentation uses four-column tab stops, so the text after it keeps its column.

**Style rule**, fixed by `format`. Presets: none. Dialects: all. Options:
`codeBlocks`, `ignoredCodeLanguages`, `spacesPerTab`.

For example, `a<Tab>b` becomes `a b`, and ` <Tab>- child` becomes `    - child`
outside Obsidian. `<Tab>` here stands for a literal tab.

| Option                 | Default | Meaning                                                                               |
| ---------------------- | ------- | ------------------------------------------------------------------------------------- |
| `codeBlocks`           | `true`  | Report tabs in code blocks and spans, without fixes.                                  |
| `ignoredCodeLanguages` | `[]`    | Case-insensitive code languages whose tabs are neither reported nor fixed.            |
| `spacesPerTab`         | `1`     | Nonnegative integer replacement width in prose; indentation always follows tab stops. |

A zero `spacesPerTab` removes prose tabs only beside an existing ASCII space;
otherwise it reports without a fix to avoid joining words.

```json
{ "rules": { "style/no-tabs": ["warn", { "ignoredCodeLanguages": ["make", "makefile", "go"] }] } }
```

## Edge cases and advanced usage

**Details:** prose tabs are replaced as `style/wrap` replaces them when
reflowing. Physical leading indentation uses four-column tab stops instead: a
tab after one space becomes three spaces, preserving the column of the following
text. The rule is opt-in because tabs can be intentional, particularly in code.

**Reported without a fix:**

- Tabs in container prefixes that are not entirely leading indentation, since a
  marker can consume only part of a tab.
- Code, which is literal content: code blocks and spans, math, HTML, and front
  matter.
- Tables and link syntax.
- ATX and Setext heading tabs, in every dialect, to keep heading anchors and
  heading links intact.

**Left as written:** prose tabs in a block that holds inline HTML, which can
make whitespace significant. Renderer protections can also suppress findings and
edits in ambiguous regions.

## Dialect notes

**In Obsidian:** leading tabs stay as written, because its views can read list
nesting and tab-only lines differently.

**In VitePress:** container delimiters, attributes, includes, table-of-contents
syntax, and Vue `{{ }}` interpolations also report tabs without fixes. Indented
code is reported under `codeBlocks` as in the other dialects.
