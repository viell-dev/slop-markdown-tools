import type { Nodes, Parents, Root } from "mdast";
import type { Document } from "../core/types.js";

/**
 * A list marker as CommonMark reads one at the start of a line's content: a
 * bullet, `-`, `*`, or `+`, or a number of one to nine digits followed by `.`
 * or `)`, and then a space, a tab, or the end of the line.
 */
export const listMarker = /^(?:[-+*]|\d{1,9}[.)])(?:[ \t\r\n]|$)/;
/**
 * A line whose content, after blank space and block quote markers, starts with
 * `:` and a space or tab. In a paragraph, such a line opens a definition
 * description on Forgejo and Gitea.
 */
export const descriptionLine = /^[ \t>]*:[ \t]/m;

/**
 * Text that the parser read where renderers may read a list, or on Forgejo and
 * Gitea a definition description, and the blocks after it.
 */
export interface MisreadLists {
  /**
   * Paragraphs, and headings underlined with `===` or `---`, whose text starts
   * with a list marker, and the text that renderers read as continuing it.
   */
  text: ReadonlySet<Nodes>;
  /**
   * The blocks after such text, or after a description, in its container whose
   * first lines start further right than the text, up to one that does not.
   * Renderers may read them inside the list's last item or the description,
   * where their indentation counts from the item's text: an indented code block
   * can be a paragraph there.
   */
  nested: ReadonlySet<Nodes>;
  /**
   * The block after those below such text, which starts no further right than
   * the text. Renderers may read it as more items of the list.
   */
  next: ReadonlySet<Nodes>;
  /**
   * In the Forgejo and Gitea dialects, paragraphs with a line that opens a
   * definition description, as `Term` and `: 2. x` do. Those renderers read
   * the description as blocks, here an ordered list (issue #344).
   */
  descriptions: ReadonlySet<Nodes>;
  /**
   * In the Obsidian dialect, the blocks that Reading view reads as more of an
   * HTML block above them. A line of blank space directly below an HTML block
   * that ends at a blank line continues the block, and so do the blocks after
   * it, up to an empty line (issue #358).
   */
  htmlText: ReadonlySet<Nodes>;
}

/** Leaf blocks: their children, if they have any, are not blocks. */
const leaves = new Set<Nodes["type"]>(["paragraph", "heading", "table", "code", "html"]);
const found = new WeakMap<Root, MisreadLists>();

/**
 * Where renderers may read a list in text that the parser read as text.
 *
 * micromark refuses to start a list that does not start at 1, or an empty
 * item, where it would interrupt a paragraph, as CommonMark says, but also
 * where no paragraph is open: at the start of a list item, block quote, or
 * footnote definition below a paragraph, and after an indented code block
 * (issue #191). It reads the line as text there, where GitHub, commonmark.js,
 * and markdown-it read a list. By CommonMark's rules, text can start with a
 * list marker only below a link reference definition, as what remains of the
 * definition's lines; GitHub and commonmark.js read text there too, and
 * markdown-it a list. The paragraph of a task list item starts after its
 * checkbox, which renderers read as the start of the item's text, so it does
 * not count. Renderers read the `===` below such text as text, of the list
 * item or after an empty one, so a paragraph or heading on the next line
 * continues it too, and a block there is nested: a `---` would underline it.
 * Where such text ends a list item or block quote, renderers continue it
 * lazily into a paragraph or heading on the next line below the container.
 *
 * Forgejo and Gitea read a definition list, which the parser reads as text:
 * `Term` and a line `: 2. x` below it are a term and a description, and the
 * description holds blocks, here an ordered list, as a list item does. The
 * blocks indented below it in its container belong to it too (issue #344).
 */
export function misreadLists(document: Document): MisreadLists {
  const known = found.get(document.tree);
  if (known) return known;
  const { source } = document;
  const forge = document.dialect === "forgejo" || document.dialect === "gitea";
  const text = new Set<Nodes>();
  const nested = new Set<Nodes>();
  const next = new Set<Nodes>();
  const descriptions = new Set<Nodes>();
  /** The column of the first character from `offset` on, after spaces and tabs. */
  const columnAt = (offset: number) => {
    let start = offset;
    while (start > 0 && source[start - 1] !== "\n" && source[start - 1] !== "\r") start--;
    let column = 0;
    for (let at = start; at < source.length; at++) {
      const character = source[at];
      if (at >= offset && character !== " " && character !== "\t") break;
      column = character === "\t" ? column + 4 - (column % 4) : column + 1;
    }
    return column;
  };
  /** Where a paragraph's or an underlined heading's text starts. */
  const textStart = (node: Nodes): number | undefined => {
    const start = node.position?.start.offset;
    if (start === undefined || node.position?.end.offset === undefined) return undefined;
    if (node.type === "paragraph") return start;
    // An underlined heading below link reference definitions starts at them.
    if (node.type === "heading" && source[start] !== "#")
      return node.children[0]?.position?.start.offset ?? start;
    return undefined;
  };
  /** Returns the last line of misread text that ends `parent` and whose `===` renderers read as text. */
  const visit = (parent: Parents): number | undefined => {
    let reach: number | undefined;
    /** The last line of misread text whose `===` renderers read as text, if the last block is that. */
    let continued: number | undefined;
    /** Whether that text ends the last block, a container, rather than being it. */
    let inside = false;
    /** The column of the last definition description while the blocks after it may belong to it. */
    let described: number | undefined;
    parent.children.forEach((child, index) => {
      const offset = child.position?.start.offset;
      if (offset === undefined) return;
      const start = textStart(child);
      if (described !== undefined) {
        if (columnAt(offset) > described) nested.add(child);
        else described = undefined;
      }
      if (
        forge &&
        start !== undefined &&
        descriptionLine.test(source.slice(offset, child.position!.end.offset))
      ) {
        descriptions.add(child);
        described = Math.min(described ?? columnAt(offset), columnAt(offset));
      }
      // Renderers continue the text lazily on the line below the container
      // that it ends, but only with text (issue #343).
      const adjacent =
        continued === child.position!.start.line - 1 && (!inside || start !== undefined);
      const misread =
        start !== undefined &&
        (listMarker.test(source.slice(start, start + 11)) || adjacent) &&
        !(index === 0 && parent.type === "listItem" && typeof parent.checked === "boolean");
      if (misread || adjacent || reach !== undefined) {
        const column = columnAt(misread ? start! : offset);
        if ((adjacent && !misread) || (reach !== undefined && column > reach)) nested.add(child);
        else if (reach !== undefined) {
          next.add(child);
          reach = undefined;
        }
        if (misread) {
          text.add(child);
          reach = Math.min(reach ?? column, column);
        }
      }
      continued =
        misread && child.type === "heading" && child.depth === 1
          ? child.position!.end.line
          : undefined;
      inside = false;
      if ("children" in child && !leaves.has(child.type)) {
        const last = visit(child);
        if (last !== undefined && last === child.position!.end.line) {
          continued = last;
          inside = true;
        }
      }
    });
    return continued;
  };
  visit(document.tree);
  const htmlText = new Set<Nodes>();
  if (document.dialect === "obsidian") {
    const lines = source.split(/\r\n|\r|\n/);
    /** Whether line `number`, counted from 1, holds blank space and more than block quote markers. */
    const spaced = (number: number) => {
      const line = lines[number - 1] ?? "";
      return /^[ \t>]*$/.test(line) && /[^>]/.test(line);
    };
    const continued = (parent: Parents) => {
      /** Whether the last block is an HTML block, or its text, that the next block may continue. */
      let open = false;
      parent.children.forEach((child, index) => {
        const previous = parent.children[index - 1];
        if (open && previous?.position && child.position) {
          for (let line = previous.position.end.line + 1; line < child.position.start.line; line++)
            if (!spaced(line)) open = false;
          if (open) htmlText.add(child);
        }
        // Other HTML blocks end at their own end marker, as a comment does at `-->`.
        if (
          !open &&
          child.type === "html" &&
          child.position &&
          !/^<(?:!--|\?|!\[CDATA\[|![A-Za-z]|(?:script|pre|style|textarea)(?:[\s>]|$))/i.test(
            child.value,
          )
        )
          open = spaced(child.position.end.line + 1);
        if (!htmlText.has(child) && "children" in child && !leaves.has(child.type))
          continued(child);
      });
    };
    continued(document.tree);
  }
  const result = { text, nested, next, descriptions, htmlText };
  found.set(document.tree, result);
  return result;
}
