import { walk } from "../syntax/walk.js";
import type { Finding, Rule } from "../core/types.js";
import { protectedEdit } from "../core/protection-edits.js";
import { codeSpanText, joinsTomlFrontMatter, lazyIndentation, range } from "../syntax/parse.js";
import { headingAttributeBlock } from "../workspace/heading-attributes.js";
import { takesFinalLineEnding, underlinedHeadings, underlineEdit } from "./blocks.js";
import { escaped } from "../syntax/source.js";
import { type Range, inlineBlocks } from "./shared.js";
import { goldmarkForges, obsidianOpaque, calloutTitles, giteaPyLine } from "./protections.js";
import { markerRule } from "./emphasis.js";
import { table } from "./table.js";
import { blockSpacing } from "./block-spacing.js";
import { wrap } from "./wrap.js";
import { headingIndentation } from "./lists.js";
import { lineBounds, lineEnding } from "../syntax/source.js";
import { optionsSchema } from "./shared.js";

const styleRules: Record<string, Rule> = {
  "style/wrap": wrap,
  "style/inline-code": {
    description: "Join multiline code spans using their CommonMark rendered value.",
    kind: "style",
    phase: "inline",
    schema: optionsSchema({}),
    check({ document }) {
      const findings: Finding[] = [];
      const { source } = document;
      const forge = goldmarkForges[document.dialect] !== undefined;
      // In Obsidian, the inline nodes whose source joined lines cannot change.
      const opaque: Range[] = [];
      if (document.dialect === "obsidian")
        walk(document.tree, (node) => {
          if (obsidianOpaque.has(node.type) || node.type === "obsidianComment")
            opaque.push(range(node));
        });
      const titles = calloutTitles(document);
      let headingEnd = 0;
      let blockStart = 0;
      walk(document.tree, (node) => {
        if (node.type === "heading" && forge) headingEnd = range(node)[1];
        if (inlineBlocks.has(node.type)) blockStart = range(node)[0];
        if (node.type !== "inlineCode") return;
        const [start, end] = range(node);
        if (!/[\r\n]/.test(source.slice(start, end))) return;
        // Forgejo and Gitea look for a heading's attribute block on its last
        // text line, and Forgejo also builds the anchor from that line alone.
        // Joining lines would change what that line holds.
        if (start < headingEnd) return;
        // Joining keeps the spaces and tabs that start a lazy continuation line,
        // as GitHub shows them; commonmark.js drops them, and the other
        // dialects' renderers were not observed there.
        if (document.dialect !== "github" && lazyIndentation(node)) return;
        if (document.dialect === "gitea" && giteaPyLine(document, start, end)) return;
        // Joining lines could put a `\(` and `\)` on one line and turn them into math.
        if (forge) {
          const lines = document.source.slice(...lineBounds(document.source, start, end));
          if (lines.includes("\\(") && lines.includes("\\)")) return;
        }
        // Joining would move text onto the line of a callout's or alert's
        // marker, which holds an Obsidian callout's title.
        if (titles.some(([a, b]) => start >= a && start < b)) return;
        // Where its backticks do not pair, as on GitHub after an unpaired
        // longer run, two spaces or a backslash at a line end make a hard break
        // (issue #335).
        if (/(?: {2}|\\)(?:\r\n|\r|\n)/.test(source.slice(start, end))) return;
        if (document.dialect === "obsidian") {
          // Obsidian reads highlights and wikilinks only within a line. Once
          // the lines are one, an `==` or `[[` left as text could open one that
          // runs to the next `==` or `]]`, even inside this or another span.
          const [from, to] = lineBounds(source, start, end);
          const lines = source.slice(from, to);
          let text = "";
          let cursor = from;
          for (const [a, b] of opaque) {
            if (b <= cursor || a >= to) continue;
            // A space keeps the text on both sides from forming a marker.
            text += source.slice(cursor, Math.max(cursor, a)) + " ";
            cursor = Math.min(b, to);
          }
          text += source.slice(cursor, to);
          if (
            (text.includes("==") && (lines.match(/==/g) ?? []).length > 1) ||
            (text.includes("[[") && lines.includes("]]"))
          )
            return;
        }
        // The joined span holds the text that GitHub shows. A space at each end
        // keeps a backtick there from joining the fence, or spaces there from
        // being taken off.
        const value = codeSpanText(node);
        let longest = 0;
        for (const run of value.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
        const marker = "`".repeat(longest + 1);
        // An earlier run of the new backticks that the parser left as text, or
        // that lies in a link destination, would pair with the new opening one.
        // The span's own backticks cannot have such a run before them.
        if (marker.length !== /^`+/.exec(source.slice(start, end))![0].length) {
          const before = source.slice(blockStart, start);
          for (const run of before.matchAll(/`+/g)) {
            const length = run[0].length;
            if (
              length === marker.length ||
              (escaped(before, run.index) && length - 1 === marker.length)
            )
              return;
          }
        }
        const pad = /^`|`$/.test(value) || (/^ .* $/.test(value) && /[^ ]/.test(value)) ? " " : "";
        findings.push({
          start,
          end,
          message: "Join the code span onto one line.",
          edit: { start, end, text: `${marker}${pad}${value}${pad}${marker}` },
        });
      });
      return findings;
    },
  },
  "style/emphasis": markerRule("emphasis", "_"),
  "style/strong": markerRule("strong", "*"),
  "style/table": table,
  "style/final-newline": {
    description: "End nonempty documents with a newline.",
    kind: "style",
    phase: "document",
    schema: optionsSchema({}),
    check({ document }) {
      const { source } = document;
      // An unclosed block at the end, such as an HTML comment, would take in the line ending.
      if (!source || /[\r\n]$/.test(source) || takesFinalLineEnding(document)) return [];
      return [
        {
          start: source.length,
          message: "Add a final newline.",
          edit: { start: source.length, end: source.length, text: lineEnding(source) },
        },
      ];
    },
  },
  "style/heading": {
    description: "Use ATX or Setext headings with single-space hash separators.",
    kind: "style",
    phase: "block",
    schema: optionsSchema({
      style: { enum: ["atx", "setext", "consistent"] },
      closing: { enum: ["remove", "keep", "add"] },
    }),
    check({ document, options }) {
      const findings: Finding[] = [];
      const { source } = document;
      // Only levels 1 and 2 can be underlined; deeper headings keep their `#`.
      const underlined = underlinedHeadings(document, options.style);
      const protectedHeading = protectedEdit(document);
      walk(document.tree, "heading", (node) => {
        const [headingStart, end] = range(node);
        const first = node.children[0];
        const last = node.children.at(-1);
        // A heading that a renderer protection covers in part keeps all of its
        // indentation: it can belong to a list the parser missed (#191), or a
        // view can read it as text, as Obsidian does with a reference-like
        // Setext title whose underline is protected (#434). Its leading spaces
        // lie before the protected source, so check the heading's whole range.
        const indentation = protectedHeading({ start: headingStart, end, text: "" })
          ? []
          : headingIndentation(document, node);
        if (indentation.length) {
          for (const [start, end] of indentation)
            findings.push({
              start,
              end,
              message: "Remove the heading's indentation.",
              edit: { start, end, text: "" },
            });
          // Reparse before conversion so source offsets and container prefixes stay exact.
          return;
        }
        // An ATX heading is one line, a Setext heading also has its underline.
        if (!/[\r\n]/.test(source.slice(headingStart, end))) {
          const edit = underlined ? underlineEdit(document, node) : undefined;
          if (edit) {
            findings.push({
              start: edit.start,
              end: edit.end,
              message: "Use an underlined heading.",
              edit,
            });
            return;
          }
          const opening = /^#{1,6}([ \t]+)/.exec(source.slice(headingStart, end));
          if (opening) {
            const start = headingStart + opening[0].length - opening[1]!.length;
            const text = first || /#/.test(source.slice(start, end)) ? " " : "";
            if (opening[1] !== text)
              findings.push({
                start,
                end: start + opening[1]!.length,
                message: "Use one space after the opening # sequence.",
                edit: { start, end: start + opening[1]!.length, text },
              });
          }
          const textEnd = last
            ? range(last)[1]
            : headingStart + /^#*/.exec(source.slice(headingStart))![0].length;
          const lineEnd = lineBounds(source, textEnd, textEnd)[1];
          const closed = /^[ \t]+#+[ \t]*$/.test(source.slice(textEnd, lineEnd));
          // Gitea before 1.26 reads an attribute block that a closing sequence
          // follows, and Forgejo and later Gitea versions do not.
          if (
            goldmarkForges[document.dialect] &&
            first &&
            headingAttributeBlock(source.slice(range(first)[0], textEnd))
          )
            return;
          if (options.closing === "add") {
            const text = ` ${"#".repeat(node.depth)}`;
            if (source.slice(textEnd, lineEnd) !== text)
              findings.push({
                start: textEnd,
                end: lineEnd,
                message: "Use a matching closing # sequence.",
                edit: { start: textEnd, end: lineEnd, text },
              });
            return;
          }
          if (!closed) return;
          if (options.closing === "keep") {
            // Empty closed headings share a single separator between the runs.
            if (!first) return;
            const separator = /^[ \t]+/.exec(source.slice(textEnd, lineEnd))![0];
            if (separator !== " ")
              findings.push({
                start: textEnd,
                end: textEnd + separator.length,
                message: "Use one space before the closing # sequence.",
                edit: { start: textEnd, end: textEnd + separator.length, text: " " },
              });
            return;
          }
          findings.push({
            start: textEnd,
            end: lineEnd,
            message: "Remove the closing # sequence.",
            edit: { start: textEnd, end: lineEnd, text: "" },
          });
          return;
        }
        if (underlined || !first || !last) return;
        // Renderers without TOML front matter read its lines as part of a
        // heading underlined directly below it (issue #333).
        if (joinsTomlFrontMatter(document.tree, node)) return;
        // Below link reference definitions, the heading's position starts at
        // the first definition; its own text starts on a later line. Headings
        // that are indented or inside lists or block quotes are left as written.
        const start = range(first)[0];
        if (lineBounds(source, start, start)[0] !== start) return;
        let text = source.slice(start, range(last)[1]);
        if (/[\r\n]/.test(text)) return;
        // Live Preview can hide a Setext title's closing hash run, where the
        // escaped ATX form reveals it. Keep that heading form in Obsidian (#383).
        if (document.dialect === "obsidian" && /(^|\s)(#+)$/.test(text)) return;
        // A trailing run of # after whitespace would become an ATX closing
        // sequence and disappear from the heading; escape its first character.
        text = text.replace(/(^|\s)(#+)$/, "$1\\$2");
        // Forgejo and Gitea also take such a run for a closing sequence when
        // their attribute block follows it, and would drop it from the heading.
        const block = goldmarkForges[document.dialect] ? headingAttributeBlock(text) : undefined;
        if (block)
          text =
            text.slice(0, block.start).replace(/(^|\s)(#+)(\s*)$/, "$1\\$2$3") +
            text.slice(block.start);
        findings.push({
          start,
          end,
          message: "Use an ATX heading.",
          edit: {
            start,
            end,
            text: `${"#".repeat(node.depth)} ${text}${options.closing === "add" && !block ? ` ${"#".repeat(node.depth)}` : ""}`,
          },
        });
      });
      return findings;
    },
  },
  "style/block-spacing": blockSpacing,
};
export { styleRules };
