// A plugin with one problem rule and one style rule.
//
// Problem rules report findings and never change a document. Style rules may
// attach an edit, which `mdrefine format` applies after checking that the
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
      rules: { "house/no-placeholder": "error", "house/heading-space": "warn" },
    },
  },
  rules: {
    "no-placeholder": {
      description: "Report placeholder words left in prose.",
      kind: "problem",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          words: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1 },
        },
      },
      check({ document, options }) {
        const words = options.words ?? ["TODO", "TBD"];
        const findings = [];
        // Only plain text is searched. Code is skipped on purpose, and so is syntax
        // that a dialect parses into a node of its own, such as an Obsidian highlight.
        visit(document.tree, (node) => {
          if (node.type !== "text") return;
          const start = node.position.start.offset;
          const end = node.position.end.offset;
          // `node.value` is the text a reader sees. Where the source spells it with
          // escapes or character references, offsets into it do not fit the source,
          // so the finding then covers the whole run of text.
          const exact = document.source.slice(start, end) === node.value;
          for (const word of words) {
            let at = node.value.indexOf(word);
            while (at >= 0) {
              findings.push({
                start: exact ? start + at : start,
                end: exact ? start + at + word.length : end,
                message: `Replace the placeholder "${word}" before publishing.`,
              });
              at = exact ? node.value.indexOf(word, at + word.length) : -1;
            }
          }
        });
        return findings;
      },
    },
    "heading-space": {
      description: "Write one space between a heading's # marks and its text.",
      kind: "style",
      phase: "block",
      check({ document }) {
        const findings = [];
        visit(document.tree, (node) => {
          if (node.type !== "heading" || !node.children.length) return;
          const start = node.position.start.offset;
          const text = node.children[0].position.start.offset;
          const marks = document.source.slice(start, text);
          const wanted = `${"#".repeat(node.depth)} `;
          // Only a "#" heading starts with its marks: an underlined heading
          // starts with its text, and so the check below leaves it alone. The
          // parser drops the blank space before a heading's text, so changing
          // it cannot change what the heading says.
          if (!/^#+[ \t]+$/.test(marks) || marks === wanted) return;
          findings.push({
            start,
            end: text,
            message: "Write one space after the heading's # marks.",
            edit: { start, end: text, text: wanted },
          });
        });
        return findings;
      },
    },
  },
};
