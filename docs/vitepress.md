# VitePress

The `vitepress` dialect targets VitePress 2, verified against 2.0.0-alpha.20.
Select it explicitly; finding `.vitepress/` does not change the assumed dialect
or execute the site's JavaScript configuration.

```jsonc
{
  "extends": ["recommended", "vitepress"],
  "vitepress": {
    "math": false,
    "anchor": "vitepress",
  },
}
```

## Renderer options

The `vitepress` object works in configuration, presets, and overrides. Fields
merge in the same order as other settings. Its options describe the renderer;
set them to match the site rather than to choose a formatting style.

| Option                | Default       | Meaning                                                                 |
| --------------------- | ------------- | ----------------------------------------------------------------------- |
| `math`                | `false`       | Read the dollar syntax of `markdown-it-mathjax3` 4.x.                   |
| `attrs`               | `true`        | Read VitePress's curly attributes, except fence attributes.             |
| `footnote`            | `true`        | Read named footnotes and preserve inline `^[notes]`.                    |
| `tasklist`            | `true`        | Read task checkboxes. With `false`, `[X]` is literal text.              |
| `cjkFriendlyEmphasis` | `true`        | Follow VitePress's CJK emphasis conditions.                             |
| `customContainers`    | `[]`          | Additional lowercase container names, such as `["example"]`.            |
| `srcDir`              | Inferred      | Source directory relative to the workspace root.                        |
| `anchor`              | `"vitepress"` | The VitePress slugger, or `"github"` for a site using `github-slugger`. |

`raw`, `v-pre`, and `code-group` are reserved built-in container names. An array
of custom names replaces the inherited array. The tool does not infer these
settings from VitePress configuration. Other renderer plugins, custom attribute
grammars, arbitrary slug functions, and VitePress 1 are outside this dialect's
contract.

## Preservation

VitePress combines Markdown with Vue templates. A newline containing nothing but
whitespace between two inline elements can disappear in Vue's output, where a
space remains visible. Wrapping leaves paragraphs with such gaps as written, and
its [`reportUnreflowed`](rules.md#stylewrap) option reports them. Ordinary
paragraphs still reflow.

Curly attributes keep their position; braces in a code span are code, not
attributes. Containers separate blocks, including the paragraphs immediately
above and below their edges. Front matter follows gray-matter's boundaries and
remains opaque; an unclosed opener protects the whole document. TOML fences are
ordinary Markdown here. Components and other renderer-only blocks are preserved;
where mdast cannot represent a component boundary, its containing block is left
as written. Paragraphs with inline footnotes remain opaque. Findings and edits
in opaque areas are omitted, because mdast does not describe their full reading;
with `reportUnreflowed: true`, `style/wrap` still reports a paragraph there that
is too wide and that it keeps as written.

With math enabled, `$` follows VitePress's inline conditions and `$$` may
interrupt a paragraph or close on the same line. The tool never evaluates
MathJax or Vue. It compares a second synchronous syntax reading, including
attributes and Vue-sensitive gaps, alongside positioned mdast. Configured [code
formatters](configuration.md#code-formatters) can change a selected fenced body
while that guard protects the surrounding page.

Fence aliases stay case-sensitive for `codeFormatters`. VitePress decorations
such as `js{1,3}` and `ts:line-numbers=2` are metadata, so those blocks route as
`js` and `ts`. Written aliases such as `js-vue` remain distinct; no command is
selected by guessing a Shiki alias.

## Links and anchors

Root-relative paths count from `srcDir`. Without it, the closest ancestor
containing `.vitepress/` is used, or the workspace root when none is known. A
source directory must stay inside the workspace. A library host supplies the
same `vitepress` options to `createWorkspace` that it passes to `format`.

Extensionless links and `.html` paths reach `.md` pages; a directory reaches
`index.md`. VitePress's known asset suffixes name files instead of pages, and
root-relative assets are checked under `public/`. Query strings do not change
the file selected. Links with `target` or `download` attributes bypass page
checks and rewriting as in VitePress. Same-page fragments still follow its
fragment normalization.

Page paths can be normalized by `links/path`. Asset URLs remain as written:
VitePress imports source images differently from public URLs, and a filesystem
alias is not enough to prove that a different asset URL still works after a
build.

The default slugger removes combining marks and control characters, turns
punctuation runs into hyphens, prefixes a leading digit with `_`, and numbers
duplicates. Heading image descriptions and math source contribute; emoji and
inline HTML tags do not. Curly `{#id}` attributes set explicit IDs. Link
fragments pass through the selected slugger after URI decoding, as in
VitePress 2. The `github` strategy selects GitHub's slug function with
VitePress's own heading-text and collision rules.

<code>&lt;!-- @include: path --&gt;</code> contributes anchors in document order. Relative paths,
`@/` source paths, line ranges, named regions, heading sections, and nested
includes are checked from text supplied by the workspace. Non-Markdown included
files need text or a loader too. The Node host reads them lazily, within its
existing workspace and symlink boundaries. Cycles remain comments. An expansion
stops after 64 levels, 10,000 visits, or 16,777,216 UTF-16 code units.
Unavailable text or selectors leave fragments unchecked, with a diagnostic
explaining that the target or its included text could not be fully checked.

The tool does not load route rewrites, dynamic routes, custom base-path
mappings, runtime component-generated IDs, or JavaScript slug functions. Supply
source paths for static checks and suppress a check whose result needs one of
those runtime decisions. The built-in anchor strategies cover static Markdown
and HTML IDs. Headings that use `$frontmatter` interpolation leave fragments
unchecked: their IDs depend on metadata interpretation, which this tool does not
execute. Use explicit static `{#id}` attributes for such headings when fragment
checks are required.
