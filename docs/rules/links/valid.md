# `links/valid`

Reports a local link, image, wikilink, embed, or reference definition whose
target does not exist, and a fragment (`#heading`, `#^block`) that its target
does not have. A target that is missing or ambiguous is reported, never guessed.

**Problem rule**, reported only. Presets: `recommended` (error). Dialects: all.
Options: `ignoredFragments`, `exactCase`.

Reported when `docs/guide.md` does not exist, or has no heading named "Setup":

```markdown
See the [guide](docs/guide.md#setup).
```

| Option             | Values                            | Default |
| ------------------ | --------------------------------- | ------- |
| `ignoredFragments` | A regular expression, as a string | `""`    |
| `exactCase`        | `true` or `false`                 | `false` |

- `ignoredFragments`: a JavaScript regular expression for fragments that are not
  checked, such as `"^figure-"` for anchors that a site generator adds. It is
  tested, without flags, against the fragment after `#` with its percent escapes
  decoded, such as `^id` for a block reference. A matching fragment is neither
  reported missing nor reported as not checkable, while its file still has to
  exist. The default, `""`, ignores none. A pattern that is not a valid regular
  expression is a configuration error.
- `exactCase`: with `true`, also report a fragment whose letter case differs
  from the anchor it reaches, for documents that are read in more than one
  renderer; it is reported with the anchor as the target spells it. By default a
  fragment is matched as the dialect's renderer matches it: GitHub and
  CommonMark ignore case, so `#Setup` reaches `## Setup`, whose anchor is
  `#setup`, and Obsidian ignores the case of headings. Forgejo, Gitea, and
  Obsidian block identifiers match exactly, so the option adds nothing there; in
  VitePress, which passes a fragment through its slugger, only a fragment that
  differs from an anchor in case alone is reported. Anchors are still generated
  per dialect, as [heading anchors](../../dialects.md#heading-anchors)
  describes. GitHub file links also ignore the case of the optional
  `user-content-` prefix; `#User-Content-setup` reaches the same anchor as
  `#setup`.

**Messages:**

| Message                                  | Meaning                                                                                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `Missing local target: …`                | No file matches.                                                                                             |
| `Ambiguous local target: …`              | Several files match, such as two notes whose names differ only by case.                                      |
| `Missing fragment in …`                  | The target exists but has no such heading, block, or anchor.                                                 |
| `Local target is a directory: …`         | Obsidian Markdown links only; other dialects accept a link to a directory, which a site can serve.           |
| `Local target is outside the vault: …`   | Obsidian only: the path leaves the note's vault, where Obsidian cannot follow it.                            |
| `Local target could not be checked: …`   | A directory that may hold it could not be read, the root is only part of a vault, or a link leaves the root. |
| `Fragment could not be checked: …`       | The target exists but could not be read, or its anchors are not fully known.                                 |
| `Fragment in … differs in letter case …` | With `exactCase` only: the fragment reaches its anchor because the renderer ignores case.                    |

## Edge cases and advanced usage

**Details:**

- The anchors that a fragment can reach depend on the dialect; see [heading
  anchors](../../dialects.md#heading-anchors). Only a Markdown file's fragments
  are checked: an image, a PDF, or a source file accepts any, such as
  `#gh-dark-mode-only`, `#page=2`, or `#L10-L20`.
- `Fragment could not be checked` also reports a readable target whose
  renderer-dependent anchor information is incomplete. It does not claim the
  fragment is missing; verified headings or explicit HTML IDs remain checkable.
- A link into a directory that the CLI does not visit, such as `dist`, or
  through a symbolic link is checked on disk; see [ignored
  files](../../configuration.md#ignored-files-and-link-targets).

**Not checked:** URLs with a scheme, such as `https:`, which are never fetched.
Outside the Obsidian dialect, neither is a destination that starts with `/` or
contains `?`, which depends on the website.

## Dialect notes

**On GitHub:** visible definition text above an interrupting table is not a link
destination; see [undefined references](../links/undefined-reference.md).

File fragments follow the native Markdown reading of dollar-math source. Heading
IDs can include dollar-delimited lines above an underlined title, and inline
markup or HTML inside such source can supply anchors too. Duplicate numbering
uses that complete reading after the YAML front matter choice; the formatter's
math reading stays the same.

**In Obsidian:** links resolve as in Obsidian: a path that starts with `./` or
`../` counts from the note; otherwise an exact path from the vault's root comes
first, then an exact path from the note, then a note found by its name or by the
end of its path. Several matches at the first level that finds any are
ambiguous. A wikilink never resolves to a directory, so the search goes on to a
note of that name. Note names and headings match without regard to case; block
identifiers match exactly. A heading matches by the text it shows or as its
source writes it, such as ``#`move` `` for ``### `move` ``, and `#Setup#Mobile`
names a heading below another one.
