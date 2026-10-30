# `content/code-language`

Reports a fenced code block that does not name its language after the opening
fence. GitHub, Forgejo, Gitea, and Obsidian highlight code by the language its
fence names; name `text` for plain text.

**Problem rule**, reported only. Presets: none. Dialects: all. Options:
`allowedLanguages`, `languageOnly`.

Reported:

````markdown
```
npm test
```
````

Not reported:

````markdown
```sh
npm test
```
````

| Option             | Values                           | Default |
| ------------------ | -------------------------------- | ------- |
| `allowedLanguages` | An array of case-sensitive names | `[]`    |
| `languageOnly`     | `true` or `false`                | `false` |

- `allowedLanguages`: the language names allowed. `[]` allows any named
  language; `["js", "ts", "text"]` permits only those names. Names are compared
  after Markdown character references and escapes are decoded, without guessing
  aliases.
- `languageOnly`: with `true`, the opening fence's info string must hold only
  its language name: no leading or trailing whitespace and no additional
  metadata.

Both options only report findings; the code and its fence remain as written.

## Edge cases and advanced usage

**Not checked:** indented code blocks, which have no place for a language.
