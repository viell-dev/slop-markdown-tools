# `style/code-fence`

Writes the fences of a fenced code block with one marker, and as long as its
content allows: three characters, or one more than the longest line inside that
holds only the marker, which would otherwise close the block. It also removes
spaces and tabs between the opening fence and its info string.

**Style rule**, fixed by `format`. Presets: `recommended` (warn). Dialects: all.
Options: `marker`.

Before:

```markdown
~~~  sh
npm test
~~~
```

After:

````markdown
```sh
npm test
```
````

`marker` is ``"```"`` (the default), `"~~~"`, or `"consistent"`, which takes the
marker of the document's first fence.

## Edge cases and advanced usage

**Details:** the info string's text and metadata, and the code content, stay as
written; nested fences keep the outer fence long enough to contain them.

**Left as written:** indented code blocks, which have no fence, and a `~~~`
fence whose info string contains a backtick, because a backtick fence cannot
have one.

## Related rules

[`content/code-language`](../content/code-language.md) reports a fence without a
language; neither rule adds one.
