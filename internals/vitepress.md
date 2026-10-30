# VitePress notes

The [VitePress](../docs/vitepress.md) page describes how the tool reads
VitePress pages. This page holds internal limits that users do not need.

## Include expansion

An expansion of <code>&lt;!-- @include: path --&gt;</code> stops after 64
levels, 10,000 visits, or 16,777,216 UTF-16 code units of text
(`src/workspace/vitepress.ts`). The page's anchors are then incomplete, and a
fragment not found among them is reported as not fully checked rather than
missing.
