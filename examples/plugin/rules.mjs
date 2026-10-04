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
    "thematic-break": {
      description: "Write thematic breaks as three hyphens.",
      kind: "style",
      phase: "block",
      check({ document }) {
        const findings = [];
        const blocks = document.tree.children;
        // In a document whose first line is the thematic break "---", a later
        // "---" would close it as front matter, so no break is rewritten there.
        const opensFrontMatter =
          blocks[0]?.type === "thematicBreak" && document.source.startsWith("---");
        for (const [index, node] of blocks.entries()) {
          if (node.type !== "thematicBreak") continue;
          const start = node.position.start.offset;
          const end = node.position.end.offset;
          if (document.source.slice(start, end) === "---") continue;
          // "---" directly below a paragraph would turn that paragraph into a
          // heading. Only propose the edit after a blank line, where it cannot.
          const previous = blocks[index - 1];
          const safe =
            !opensFrontMatter &&
            previous &&
            previous.position.end.line < node.position.start.line - 1;
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
