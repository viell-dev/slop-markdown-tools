# Rules

A rule is either a **style** rule or a **problem** rule. A style rule checks how
something is written and proposes an edit, which `format` applies and `lint`
reports. A problem rule reports a defect that has no single correct repair, and
never edits. `format` applies an edit only when the document still means the
same afterwards, and never in text that the parser reads where renderers read a
list; see [how it works](design.md#safety-model).

Enable and configure rules under `rules` in the
[configuration](configuration.md#rules-and-severity). `npx mdrefine rules` lists
the built-in rules and those of the configuration's [plugins](plugins.md), with
the descriptions below.

The tables give the severity at which a preset enables each rule, `warn` or
`error`: `recommended` in its own column, and the dialect presets by name in the
next; — means that none does. A configuration can set any rule to another
severity; see [rules and severity](configuration.md#rules-and-severity). The
`codeberg` preset is the `forgejo` preset under another name. In a dialect that
a rule's page does not name, the rule finds nothing.

Each rule's page opens with what the rule does, then gives its kind, the presets
that enable it with their severity, its dialects, and its options, an example,
and the options in detail. Edge cases, notes for particular dialects, and how
the rule works with other rules follow under their own headings.

## Content

| Rule                                                                  | What it does                                                                                | Kind    | `recommended` | Dialect presets | Options |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------- | ------------- | --------------- | ------- |
| [`content/code-language`](rules/content/code-language.md)             | Reports fenced code blocks that name no language, or one that the options disallow.         | Problem | —             | —               | Yes     |
| [`content/emphasis-spacing`](rules/content/emphasis-spacing.md)       | Reports spaces just inside emphasis markers, which make renderers show the markers as text. | Problem | —             | —               | —       |
| [`content/html-element`](rules/content/html-element.md)               | Reports HTML elements, apart from the allowed ones.                                         | Problem | —             | —               | Yes     |
| [`content/image-alt`](rules/content/image-alt.md)                     | Reports images, Markdown or HTML, without alternative text.                                 | Problem | `warn`        | —               | —       |
| [`content/inline-code-spacing`](rules/content/inline-code-spacing.md) | Reports spaces at the ends of code spans that renderers show as part of the code.           | Problem | —             | —               | —       |
| [`content/line-length`](rules/content/line-length.md)                 | Reports heading, code block, and table lines longer than a limit, without editing them.     | Problem | —             | —               | Yes     |
| [`content/proper-names`](rules/content/proper-names.md)               | Reports other capitalizations of configured names, such as `javascript` for `JavaScript`.   | Problem | —             | —               | Yes     |
| [`content/shell-prompt`](rules/content/shell-prompt.md)               | Reports shell code blocks in which every command has a prompt and no output is shown.       | Problem | —             | —               | —       |
| [`content/table-columns`](rules/content/table-columns.md)             | Reports table rows with more or fewer cells than the header row.                            | Problem | `warn`        | —               | —       |

## Forgejo and Gitea

| Rule                                                | What it does                                                                                                     | Kind    | `recommended` | Dialect presets               | Options |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------- | ------------- | ----------------------------- | ------- |
| [`forgejo/heading-id`](rules/forgejo/heading-id.md) | Reports heading attributes whose `id` is not text, which can stop Forgejo and Gitea from rendering the document. | Problem | —             | `error` in `forgejo`, `gitea` | —       |

## GitHub

| Rule                                                  | What it does                                            | Kind  | `recommended` | Dialect presets                                                 | Options |
| ----------------------------------------------------- | ------------------------------------------------------- | ----- | ------------- | --------------------------------------------------------------- | ------- |
| [`github/alert-marker`](rules/github/alert-marker.md) | Writes GitHub alert types in capitals, as in `[!NOTE]`. | Style | —             | `warn` in `github`, `forgejo`, `gitea`, `vitepress`             | —       |
| [`github/task-marker`](rules/github/task-marker.md)   | Writes the mark of a completed task as a lowercase `x`. | Style | —             | `warn` in `github`, `forgejo`, `gitea`, `obsidian`, `vitepress` | —       |

## Links

| Rule                                                              | What it does                                                                          | Kind    | `recommended` | Dialect presets | Options |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------- | ------------- | --------------- | ------- |
| [`links/allowed-notation`](rules/links/allowed-notation.md)       | Reports the link and image forms that the options disallow.                           | Style   | —             | —               | Yes     |
| [`links/bare-url`](rules/links/bare-url.md)                       | Writes bare URLs and email addresses as autolinks, in angle brackets.                 | Style   | —             | —               | —       |
| [`links/descriptive-text`](rules/links/descriptive-text.md)       | Reports links whose whole text, such as "here", does not say where they lead.         | Problem | —             | —               | Yes     |
| [`links/empty`](rules/links/empty.md)                             | Reports links and images whose destination is empty or only `#`.                      | Problem | `warn`        | —               | Yes     |
| [`links/notation`](rules/links/notation.md)                       | Converts Obsidian links between Markdown and wikilink notation.                       | Style   | —             | —               | Yes     |
| [`links/path`](rules/links/path.md)                               | Rewrites local link destinations to the configured path style, keeping their targets. | Style   | —             | —               | Yes     |
| [`links/reversed`](rules/links/reversed.md)                       | Reports likely reversed links, such as `(text)[https://example.com]`.                 | Problem | —             | —               | —       |
| [`links/text-spacing`](rules/links/text-spacing.md)               | Reports spaces at the ends of link text, which become part of the link.               | Problem | —             | —               | —       |
| [`links/undefined-reference`](rules/links/undefined-reference.md) | Reports references whose label has no definition, which renderers show as plain text. | Problem | `warn`        | —               | Yes     |
| [`links/unused-definition`](rules/links/unused-definition.md)     | Reports link and footnote definitions that no reference uses.                         | Problem | `warn`        | —               | Yes     |
| [`links/valid`](rules/links/valid.md)                             | Reports local links and fragments whose target does not exist.                        | Problem | `error`       | —               | Yes     |

## Obsidian

| Rule                                                                  | What it does                                                                                              | Kind    | `recommended` | Dialect presets       | Options |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------- | ------------- | --------------------- | ------- |
| [`obsidian/block-reference`](rules/obsidian/block-reference.md)       | Reports block identifiers that a note uses more than once.                                                | Problem | —             | `error` in `obsidian` | —       |
| [`obsidian/callout-marker`](rules/obsidian/callout-marker.md)         | Writes Obsidian callout types in lowercase.                                                               | Style   | —             | `warn` in `obsidian`  | —       |
| [`obsidian/strict-line-breaks`](rules/obsidian/strict-line-breaks.md) | Reports notes that are not wrapped because Obsidian's "Strict line breaks" setting is not known to be on. | Problem | —             | `warn` in `obsidian`  | —       |

## Structure

| Rule                                                                      | What it does                                                                                    | Kind    | `recommended` | Dialect presets | Options |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------- | ------------- | --------------- | ------- |
| [`structure/duplicate-heading`](rules/structure/duplicate-heading.md)     | Reports headings with the same text as an earlier heading under the same parent.                | Problem | —             | —               | Yes     |
| [`structure/emphasis-heading`](rules/structure/emphasis-heading.md)       | Reports paragraphs of only emphasized or strong text, which read as headings.                   | Problem | —             | —               | Yes     |
| [`structure/heading-increment`](rules/structure/heading-increment.md)     | Reports headings more than one level deeper than the heading before them.                       | Problem | `warn`        | —               | Yes     |
| [`structure/heading-punctuation`](rules/structure/heading-punctuation.md) | Reports headings that end with sentence punctuation.                                            | Problem | —             | —               | Yes     |
| [`structure/heading-template`](rules/structure/heading-template.md)       | Reports headings that do not follow a configured sequence.                                      | Problem | —             | —               | Yes     |
| [`structure/initial-heading`](rules/structure/initial-heading.md)         | Reports a document that does not start with a heading of the configured level.                  | Problem | —             | —               | Yes     |
| [`structure/single-title`](rules/structure/single-title.md)               | Reports more than one title heading in a document, counting a front matter title.               | Problem | —             | —               | Yes     |
| [`structure/split-quote`](rules/structure/split-quote.md)                 | Reports block quotes separated only by a blank line, which may be meant as one.                 | Problem | —             | —               | —       |
| [`structure/unspaced-heading`](rules/structure/unspaced-heading.md)       | Reports text such as `#Installation` that would be a `#` heading with a space after the hashes. | Problem | —             | —               | —       |

## Style

| Rule                                                            | What it does                                                                                             | Kind  | `recommended` | Dialect presets                                                 | Options |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----- | ------------- | --------------------------------------------------------------- | ------- |
| [`style/blank-lines`](rules/style/blank-lines.md)               | Limits blank lines in a row, and removes those at the start and end of a document.                       | Style | `warn`        | —                                                               | Yes     |
| [`style/block-spacing`](rules/style/block-spacing.md)           | Separates headings, lists, fenced code blocks, and tables from the blocks around them with a blank line. | Style | `warn`        | —                                                               | Yes     |
| [`style/code-block`](rules/style/code-block.md)                 | Writes code blocks in one form, fenced or indented.                                                      | Style | —             | —                                                               | Yes     |
| [`style/code-fence`](rules/style/code-fence.md)                 | Writes code fences with one marker, only as long as their content needs.                                 | Style | `warn`        | —                                                               | Yes     |
| [`style/definition-spacing`](rules/style/definition-spacing.md) | Writes one space after a link reference definition's colon and before its title.                         | Style | —             | —                                                               | —       |
| [`style/emphasis`](rules/style/emphasis.md)                     | Writes emphasis with one marker, `_` by default.                                                         | Style | `warn`        | —                                                               | Yes     |
| [`style/final-newline`](rules/style/final-newline.md)           | Ends a document that is not empty with a line break.                                                     | Style | `warn`        | —                                                               | —       |
| [`style/heading`](rules/style/heading.md)                       | Writes headings in one style, `#` headings by default, with one space after the hashes.                  | Style | `warn`        | —                                                               | Yes     |
| [`style/inline-code`](rules/style/inline-code.md)               | Writes code spans on one line, with the fewest backticks they need.                                      | Style | —             | —                                                               | —       |
| [`style/lazy-continuation`](rules/style/lazy-continuation.md)   | Writes the quote markers and indentation on lines that continue a paragraph without them.                | Style | `warn`        | —                                                               | —       |
| [`style/line-ending`](rules/style/line-ending.md)               | Writes one configured line ending outside literal content.                                               | Style | —             | —                                                               | Yes     |
| [`style/link-title`](rules/style/link-title.md)                 | Writes link and image titles with one kind of delimiter, double quotes by default.                       | Style | —             | —                                                               | Yes     |
| [`style/list-indent`](rules/style/list-indent.md)               | Indents list items consistently, with the configured spaces after the marker.                            | Style | `warn`        | —                                                               | Yes     |
| [`style/list-marker`](rules/style/list-marker.md)               | Writes bullet lists with one marker, `-` by default.                                                     | Style | `warn`        | —                                                               | Yes     |
| [`style/no-tabs`](rules/style/no-tabs.md)                       | Reports tabs, and replaces those in prose with spaces.                                                   | Style | —             | —                                                               | Yes     |
| [`style/ordered-list`](rules/style/ordered-list.md)             | Writes ordered list numbers with one delimiter, and numbers the items consistently.                      | Style | `warn`        | —                                                               | Yes     |
| [`style/prose-space`](rules/style/prose-space.md)               | Collapses repeated spaces between words without moving line breaks.                                      | Style | —             | —                                                               | —       |
| [`style/quote-marker`](rules/style/quote-marker.md)             | Writes one space after each block quote marker, `>`.                                                     | Style | `warn`        | —                                                               | Yes     |
| [`style/strong`](rules/style/strong.md)                         | Writes strong emphasis with one marker, `*` by default.                                                  | Style | `warn`        | —                                                               | Yes     |
| [`style/table`](rules/style/table.md)                           | Pads table cells to their column's width and writes the delimiter row to match.                          | Style | `warn`        | `warn` in `github`, `forgejo`, `gitea`, `obsidian`, `vitepress` | Yes     |
| [`style/thematic-break`](rules/style/thematic-break.md)         | Writes thematic breaks as one exact text, `---` by default.                                              | Style | `warn`        | —                                                               | Yes     |
| [`style/trailing-space`](rules/style/trailing-space.md)         | Removes spaces and tabs at the end of lines, keeping hard line breaks.                                   | Style | `warn`        | —                                                               | Yes     |
| [`style/wrap`](rules/style/wrap.md)                             | Reflows paragraphs to fill the line width, 80 columns by default.                                        | Style | `warn`        | —                                                               | Yes     |

<script setup>
import { onMounted } from "vue";

// A link to a rule's section of the former single page, such as
// rules.html#stylewrap, continues to the rule's page that the tables link.
onMounted(() => {
  const fragment = decodeURIComponent(location.hash.slice(1));
  if (!fragment) return;
  for (const link of document.querySelectorAll(".vp-doc table a")) {
    const page = /\/rules\/([a-z]+)\/([a-z-]+)\.html$/.exec(new URL(link.href).pathname);
    if (page && page[1] + page[2] === fragment) return location.replace(link.href);
  }
});
</script>
