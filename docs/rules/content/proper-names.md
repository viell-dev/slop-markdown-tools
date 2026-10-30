# `content/proper-names`

Reports other capitalization of configured names in prose, link labels, and
image alt text: with `JavaScript` configured, `javascript` is reported. Changing
a name changes text, so the rule never fixes it.

**Problem rule**, reported only. Presets: none. Dialects: all. Options: `names`,
`codeBlocks`, `htmlElements`.

With `{ "names": ["JavaScript", "Node.js"] }`, reported:

```markdown
Write the plugin in javascript for node.js.
```

Not reported:

```markdown
Write the plugin in JavaScript for Node.js; run `node.js --version`.
```

| Option         | Values                        | Default |
| -------------- | ----------------------------- | ------- |
| `names`        | An array of non-empty strings | `[]`    |
| `codeBlocks`   | `true` or `false`             | `false` |
| `htmlElements` | `true` or `false`             | `true`  |

- `names`: literal names with their accepted capitalization. `[]` checks
  nothing. Several configured spellings of the same name are all accepted.
- `codeBlocks`: with `true`, the bodies of fenced and indented code blocks are
  checked too; turn it on to check prose examples written in fences.
- `htmlElements`: with `true`, the visible text of HTML is checked; tags,
  attributes, and comments are not. With `false`, a prose block containing
  inline HTML is left out as a whole, and other prose is still checked.

For example, in the configuration:

```json
{
  "rules": {
    "content/proper-names": ["warn", { "names": ["JavaScript", "Node.js"] }]
  }
}
```

## Edge cases and advanced usage

**Details:** names match literal punctuation and spaces, as in `Node.js`, `C++`,
and `GitHub Actions`. A Unicode letter, combining mark, number, or connector
punctuation next to a name prevents a match: neither `myjavascript` nor
`javascripts` matches `JavaScript`, and the same boundary applies in non-Latin
scripts. Punctuation outside a name separates it from the text around it. A
longer name takes precedence over a shorter one that overlaps it. An explicit
wikilink alias is prose.

**Not checked:** inline code, because a command or identifier often needs its
exact spelling, and code blocks by default for the same reason; the bodies of
HTML `script`, `style`, `code`, and `pre` elements; link destinations,
autolinks, bare URLs and email addresses, image sources, front matter, math,
comments, and wikilink targets.
