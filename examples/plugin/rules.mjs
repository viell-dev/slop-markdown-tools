// A plugin with one problem rule and one style rule.
//
// Problem rules report findings and never change a document. Style rules may
// attach an edit, which `mdtools format` applies after checking that the
// document still means the same thing.

/** Visit `node` and everything below it. */
function visit(node, visitor) {
  visitor(node);
  for (const child of node.children ?? []) visit(child, visitor);
}

/** @type {import("mdrefine").Plugin} */
export default {
  name: "house",
  presets: {
    recommended: {
      rules: { "house/no-placeholder": "error", "house/thematic-break": "warn" },
    },
  },
  rules: {
    "no-placeholder": {
      description: "Report placeholder words left in prose.",
      kind: "problem",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: { words: { type: "array", items: { type: "string" }, minItems: 1 } },
      },
      check({ document, options }) {
        const words = options.words ?? ["TODO", "TBD"];
        const findings = [];
        // Only `text` nodes are prose; code spans and code blocks are other node types.
        visit(document.tree, (node) => {
          if (node.type !== "text") return;
          // Search the source rather than `node.value`, so offsets stay exact
          // when the text contains escapes or character references.
          const start = node.position.start.offset;
          const source = document.source.slice(start, node.position.end.offset);
          for (const word of words) {
            for (let at = source.indexOf(word); at >= 0; at = source.indexOf(word, at + 1)) {
              findings.push({
                start: start + at,
                end: start + at + word.length,
                message: `Replace the placeholder "${word}" before publishing.`,
              });
            }
          }
        });
        return findings;
      },
    },
    "thematic-break": {
      description: "Write thematic breaks as three hyphens.",
      kind: "style",
      phase: "block",
      check({ document }) {
        const findings = [];
        const blocks = document.tree.children;
        for (const [index, node] of blocks.entries()) {
          if (node.type !== "thematicBreak") continue;
          const start = node.position.start.offset;
          const end = node.position.end.offset;
          if (document.source.slice(start, end) === "---") continue;
          // "---" directly below a paragraph would turn that paragraph into a
          // heading, and at the top of a document it could open front matter.
          // Only propose the edit after a blank line, where neither can happen.
          const previous = blocks[index - 1];
          const safe = previous && previous.position.end.line < node.position.start.line - 1;
          findings.push({
            start,
            end,
            message: "Write this thematic break as ---.",
            ...(safe ? { edit: { start, end, text: "---" } } : {}),
          });
        }
        return findings;
      },
    },
  },
};
