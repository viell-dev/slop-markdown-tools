import { Parser } from "commonmark";
import type { Node } from "commonmark";
import type { Html, Nodes, PhrasingContent } from "mdast";
import { describe, expect, it } from "vitest";
import { parse } from "../../src/index.js";
import type { Dialect } from "../../src/index.js";

const dialects = ["github", "commonmark", "forgejo", "gitea", "obsidian", "vitepress"] as const;
const blockNames: Partial<Record<Nodes["type"], string>> = {
  root: "document",
  list: "list",
  listItem: "item",
  blockquote: "block_quote",
  thematicBreak: "thematic_break",
};
/** A literal block value, independently of its line endings. */
const lines = (value: string) =>
  value
    .trim()
    .split(/\r\n|\n|\r/)
    .join("|");
/**
 * The block structure of a reading, with each paragraph's text and inline HTML
 * in order, written as commonmark.js names its nodes.
 */
function structure(node: Nodes): string {
  const phrasing = (nodes: PhrasingContent[]): string =>
    nodes
      .map((child) =>
        child.type === "html"
          ? `{${child.value}}`
          : child.type === "text"
            ? child.value
            : "children" in child
              ? phrasing(child.children)
              : "",
      )
      .join("");
  if (node.type === "paragraph" || node.type === "heading")
    return `${node.type}(${phrasing(node.children).replace(/\s+/g, " ").trim()})`;
  if (node.type === "html") return `html_block(${lines(node.value)})`;
  if (node.type === "code") return `code_block(${lines(node.value)})`;
  const children = "children" in node ? (node.children as Nodes[]) : [];
  return `${blockNames[node.type] ?? node.type}(${children.map(structure).join(",")})`;
}
function reference(node: Node): string {
  const children: Node[] = [];
  for (let child = node.firstChild; child; child = child.next) children.push(child);
  const inline = (parent: Node): string => {
    let text = "";
    for (let child = parent.firstChild; child; child = child.next)
      text +=
        child.type === "html_inline"
          ? `{${child.literal}}`
          : child.type === "text"
            ? child.literal
            : child.type === "softbreak"
              ? " "
              : inline(child);
    return text;
  };
  if (node.type === "paragraph" || node.type === "heading")
    return `${node.type}(${inline(node).replace(/\s+/g, " ").trim()})`;
  if (node.type === "html_block") return `html_block(${lines(node.literal!)})`;
  if (node.type === "code_block") return `code_block(${lines(node.literal!)})`;
  return `${node.type}(${children.map(reference).join(",")})`;
}
const commonmark = (source: string) => reference(new Parser().parse(source));
const read = (source: string, dialect: Dialect) => structure(parse(source, dialect).tree);
const crlf = (source: string) => source.replaceAll("\n", "\r\n");
const html = (source: string, dialect: Dialect): Html[] => {
  const found: Html[] = [];
  const visit = (node: Nodes) => {
    if (node.type === "html") found.push(node);
    if ("children" in node) node.children.forEach(visit);
  };
  visit(parse(source, dialect).tree);
  return found;
};

describe("a lazy line that could start a type 7 HTML block (#762)", () => {
  // A complete tag alone on its line starts HTML only where no paragraph is
  // open, so below a container's paragraph it continues the paragraph lazily,
  // as CommonMark, commonmark.js, markdown-it, Forgejo, Gitea and Obsidian
  // read it. Every dialect parses it that way; GitHub ends the containers
  // instead, which a renderer protection covers (github-lazy-html.test.ts).
  const continued: [string, string][] = [
    ["- a\n<b>\nmore\n", "document(list(item(paragraph(a {<b>} more))))"],
    ["* a\n<b>\n", "document(list(item(paragraph(a {<b>}))))"],
    ["1. a\n<b>\nmore\n", "document(list(item(paragraph(a {<b>} more))))"],
    ["2) a\n<b>\nmore\n", "document(list(item(paragraph(a {<b>} more))))"],
    ["> a\n<b>\nmore\n", "document(block_quote(paragraph(a {<b>} more)))"],
    ["> a\n</b>\nmore\n", "document(block_quote(paragraph(a {</b>} more)))"],
    ['> a\n<a href="x">\n', 'document(block_quote(paragraph(a {<a href="x">})))'],
    ["> a\n<b/>\n", "document(block_quote(paragraph(a {<b/>})))"],
    ["> a\n<b> \t\nmore\n", "document(block_quote(paragraph(a {<b>} more)))"],
    // Nesting: a quote in a list and a list in a quote.
    ["- > a\n<b>\nmore\n", "document(list(item(block_quote(paragraph(a {<b>} more)))))"],
    ["> - a\n<b>\nmore\n", "document(block_quote(list(item(paragraph(a {<b>} more)))))"],
    ["> > a\n<b>\n", "document(block_quote(block_quote(paragraph(a {<b>}))))"],
    ["- - a\n<b>\n", "document(list(item(list(item(paragraph(a {<b>}))))))"],
    // Several lazy lines, after written prefixes too, and later items.
    ["- a\n<b>\n<i>\n</b>\nmore\n", "document(list(item(paragraph(a {<b>} {<i>} {</b>} more))))"],
    ["- a\n  b\n<b>\nmore\n", "document(list(item(paragraph(a b {<b>} more))))"],
    ["> a\n> b\n<b>\n> more\n", "document(block_quote(paragraph(a b {<b>} more)))"],
    ["- a\n<b>\n- c\n", "document(list(item(paragraph(a {<b>})),item(paragraph(c))))"],
    // Upstream's own expectation closes the quote here, as GitHub does; CommonMark does not.
    ["> a\n<a>\n", "document(block_quote(paragraph(a {<a>})))"],
  ];
  it.each(dialects)("reads CommonMark's continued paragraph in %s", (dialect) => {
    for (const [source, expected] of continued)
      for (const written of [source, crlf(source)]) {
        expect(commonmark(written), JSON.stringify(written)).toBe(expected);
        expect(read(written, dialect), JSON.stringify(written)).toBe(expected);
      }
  });
  it.each(dialects)("leaves types 1 to 6 interrupting the paragraph in %s", (dialect) => {
    // These may interrupt a paragraph, so a lazy one ends the containers.
    for (const source of [
      "- a\n<script>\nmore\n",
      "> a\n<pre>\nmore\n",
      "> a\n<!-- c -->\nmore\n",
      "- a\n<!-- c -->\nmore\n",
      "> a\n<?x?>\nmore\n",
      "> a\n<!X>\nmore\n",
      "- a\n<![CDATA[x]]>\nmore\n",
      "> a\n<div>\nmore\n",
      "- a\n<div>\nmore\n",
      "> - a\n</div>\nmore\n",
      "- > a\n<table>\n",
    ])
      for (const written of [source, crlf(source)]) {
        const expected = commonmark(written);
        expect(expected, JSON.stringify(written)).toMatch(/html_block/);
        expect(read(written, dialect), JSON.stringify(written)).toBe(expected);
      }
  });
  it.each(dialects)("keeps the other lazy lines' readings in %s", (dialect) => {
    // Lines that cannot interrupt a paragraph either, read on the same path.
    for (const source of [
      "> a\n    b\n",
      "- a\n    b\n",
      "> a\n2. b\n",
      "> a\n-\n",
      "> a\n1.\n",
      "> a\n<b> c\n",
      "> a\n<b\n",
      "a\n<b>\nmore\n",
      "> <div>\n<b>\n",
      "- a\n\n<b>\n",
    ])
      for (const written of [source, crlf(source)])
        expect(read(written, dialect), JSON.stringify(written)).toBe(commonmark(written));
  });
  it.each(dialects)("positions the inline HTML on the lazy line in %s", (dialect) => {
    for (const [source, start] of [
      ["- a\n<b>\nmore\n", 4],
      ["- a\r\n<b>\r\nmore\r\n", 5],
      ["> - a\n<b>\n", 6],
      ["> - a\r\n<b>\r\n", 7],
    ] as const) {
      const [node, ...rest] = html(source, dialect);
      expect(rest).toEqual([]);
      expect(node?.position?.start).toMatchObject({ offset: start, column: 1, line: 2 });
      expect(node?.position?.end.offset).toBe(start + 3);
      expect(source.slice(start, start + 3)).toBe("<b>");
    }
  });
});
