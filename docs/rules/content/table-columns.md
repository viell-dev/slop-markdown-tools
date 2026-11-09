# `content/table-columns`

Reports a table row with more or fewer cells than the header row. As the GFM
specification requires, renderers drop the extra cells of a longer row without a
trace and fill a shorter row with empty cells, so the table does not show what
its source says.

**Problem rule**, reported only. Presets: `recommended` (warn). Dialects: all
but CommonMark. Options: none.

Reported, because the last row has three cells:

```markdown
| Name | Size |
| ---- | ---- |
| a    | 1    |
| b    | 2    | 3 |
```

Not reported:

```markdown
| Name    | Size |
| ------- | ---- |
| a       | 1    |
| `b\|c`  | 2    |
```

## Edge cases and advanced usage

**Details:** a `|` separates cells even inside code unless it is escaped as
`\|`. In the Obsidian dialect this also applies inside note links such as
`[[Note|label]]`: the label separator must be escaped when it belongs in a table
cell.

**Not checked:** the rows after a standalone colon-container boundary, such as
`:::`, which ends the rows checked. Site generators such as VitePress use colon
markers to delimit special blocks, also called containers, while GFM reads the
marker and following text as more rows. A cell written as `| ::: |` is checked
normally.
