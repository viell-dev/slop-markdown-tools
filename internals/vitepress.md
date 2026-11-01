# VitePress notes

The [VitePress](../docs/vitepress.md) page describes how the tool reads
VitePress pages. This page holds internal limits that users do not need.

## Opaque component boundaries

When a component makes a primary block opaque, the projection records that
node's identity. Block spacing applies its existing misread-table guard to those
nodes too: a new separator can turn table text held with a component into a
primary table plus a component-only HTML node, even when VitePress's actual
rendering stays the same. Keep the boundary instead of proposing an edit the
engine must refuse. Ordinary HTML and formatting outside that region retain
their existing behavior
([#800](https://github.com/viell-dev/slop-markdown-tools/issues/800)).

## Code-span continuation text

Wrapping compares the existing cached VitePress code text with the primary
joined reading before joining a span's physical lines. Both use the same
single-space padding convention; spans containing only spaces retain all of
them. A disagreement keeps the paragraph split, with a reason available to
`reportUnreflowed`. This reuses node metadata and adds no parse or change to the
engine's preservation contract
([#782](https://github.com/viell-dev/slop-markdown-tools/issues/782)).

## Body entity spelling

VitePress's text joining restores an entity's written spelling only when it
joins another text token. Its singleton can retain the decoded value. The
secondary fingerprint compares eligible body singletons with that same written
spelling, without modifying the cached reader tokens. The HTML decoder must
agree with the singleton value: some numeric references render differently in
these two positions. Whitespace and brace entities remain literal because of
Vue's gaps and expressions. Headings, image alt children, code, and inline
blocks containing raw HTML or mustaches keep their previous reading. The primary
fingerprint still applies unchanged
([#863](https://github.com/viell-dev/slop-markdown-tools/issues/863)).

## Include expansion

An expansion of <code>&lt;!-- @include: path --&gt;</code> stops after 64
levels, 10,000 visits, or 16,777,216 UTF-16 code units of text
(`src/workspace/vitepress.ts`). The page's anchors are then incomplete, and a
fragment not found among them is reported as not fully checked rather than
missing.
