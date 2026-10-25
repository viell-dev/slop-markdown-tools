import type { Nodes, Parents } from "mdast";
import type { Document } from "../core/types.js";
import { startsWithMarker } from "./parse.js";
import { codeFence } from "./fences.js";
import { lineBreakMatcher } from "./source.js";
import { leaves } from "./protection-source.js";
import type { ProtectionSource } from "./protection-source.js";

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
/** An adjacent list that Live Preview groups with the preceding item's secondary block. */
export function continuesListBlock(source: string, before: Nodes, after: Nodes): boolean {
  if (
    before.type !== "list" ||
    after.type !== "list" ||
    !before.position ||
    !after.position ||
    before.position.end.line !== after.position.start.line - 1
  )
    return false;
  const blocks = before.children.at(-1)?.children;
  const last = blocks?.at(-1);
  return (
    (last?.type === "paragraph" && blocks!.length > 1) ||
    (last?.type === "code" && last.position !== undefined && !codeFence(source, last))
  );
}

/**
 * Collect list and definition-description readings that differ from the primary tree.
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
 *
 * Obsidian starts a list below a paragraph line where CommonMark does not:
 * Live Preview at an ordered marker with a number other than 1 and text after
 * it, except in a block quote, and Reading view at an empty item, `*`, `+`,
 * `- `, or `1.`, which Live Preview reads so for `+ ` and `- ` (issue #375).
 */

export function collectListProtections(document: Document, positions: ProtectionSource) {
  const { source } = document;
  const forge = document.dialect === "forgejo" || document.dialect === "gitea";
  const text = new Set<Nodes>();
  const nested = new Set<Nodes>();
  const next = new Set<Nodes>();
  const descriptions = new Set<Nodes>();
  const obsidian = document.dialect === "obsidian";
  const { columnAt, textStart } = positions;
  /**
   * In the Obsidian dialect, the offset of the marker on the first line of
   * `node` after its first that Obsidian reads as starting a list item where
   * CommonMark reads text; `quoted` says whether `node` is in a block quote.
   */
  const obsidianItem = (node: Nodes, quoted: boolean, callout: boolean): number | undefined => {
    const end = node.position!.end.offset!;
    // A marker four or more columns right of the text is more of the text.
    const text = columnAt(node.position!.start.offset!);
    const breaks = lineBreakMatcher();
    breaks.lastIndex = node.position!.start.offset!;
    for (let found = breaks.exec(source); found && found.index < end; found = breaks.exec(source)) {
      const lineStart = found.index + found[0].length;
      let lineEnd = lineStart;
      while (lineEnd < end && source[lineEnd] !== "\n" && source[lineEnd] !== "\r") lineEnd++;
      const line = source.slice(lineStart, lineEnd);
      const prefix = /^[ \t>]*/.exec(line)![0].length;
      const content = line.slice(prefix);
      const ordered = /^(\d{1,9})[.)][ \t]+\S/.exec(content);
      if (
        columnAt(lineStart + prefix) - text <= 3 &&
        ((ordered && Number(ordered[1]) !== 1 && (!quoted || callout)) ||
          /^(?:[*+]|-(?=[ \t])|0*1[.)])[ \t]*$/.test(content))
      )
        return lineStart + prefix;
    }
    return undefined;
  };
  /** Returns the last line of misread text that ends `parent` and whose `===` renderers read as text. */
  const visit = (parent: Parents, quoted = false): number | undefined => {
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
      const atStart =
        start !== undefined &&
        (listMarker.test(source.slice(start, start + 11)) || adjacent) &&
        !(index === 0 && parent.type === "listItem" && typeof parent.checked === "boolean");
      const callout =
        parent.type === "blockquote" &&
        child.type === "paragraph" &&
        index === 0 &&
        startsWithMarker(source.slice(offset, child.position!.end.offset), child);
      const item =
        obsidian && start !== undefined ? obsidianItem(child, quoted, callout) : undefined;
      const misread = atStart || item !== undefined;
      if (misread || adjacent || reach !== undefined) {
        const column = columnAt(atStart ? start : (item ?? offset));
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
        const last = visit(child, quoted || child.type === "blockquote");
        if (last !== undefined && last === child.position!.end.line) {
          continued = last;
          inside = true;
        }
      }
    });
    return continued;
  };
  visit(document.tree);
  return { text, nested, next, descriptions };
}
