import type { RootContent } from "mdast";
import type { Rule } from "../core/types.js";
import { range } from "../syntax/parse.js";
import { optionsSchema } from "./style.js";

function content(nodes: RootContent[]): RootContent[] {
  return nodes.filter((node) => !["yaml", "toml"].includes(node.type));
}
export const structureRules: Record<string, Rule> = {
  "structure/initial-heading": {
    description: "Require the first content block to be a level-1 heading.",
    kind: "problem",
    schema: optionsSchema({}),
    check({ document }) {
      const first = content(document.tree.children)[0];
      return first?.type === "heading" && first.depth === 1
        ? []
        : [
            {
              start: first ? range(first)[0] : 0,
              message: "Start the document with a level-1 heading after optional front matter.",
            },
          ];
    },
  },
};
