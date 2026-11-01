import { directive } from "micromark-extension-directive";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { mathFromMarkdown } from "mdast-util-math";
import { fromMarkdown, gfmAutolinkLiteral, gfmFootnote } from "./parser.generated.js";
import { math } from "./math.js";

const treeExtensions = gfmFromMarkdown();
// Only compiler events are needed; do not run the legacy autolink transforms.
for (const extension of treeExtensions) delete extension.transforms;

/** Markdownlint reparses HTML flow and inspects its first inline HTML token. */
export function firstHtmlInFlow(source: string): string | undefined {
  let first: string | undefined;
  const directives = directive();
  delete directives.text;
  fromMarkdown(source, {
    extensions: [
      directives,
      gfmAutolinkLiteral(),
      gfmFootnote(),
      gfmTable(),
      math("markdownlint"),
      { disable: { null: ["codeIndented", "htmlFlow"] } },
    ],
    mdastExtensions: [
      ...treeExtensions,
      mathFromMarkdown(),
      {
        exit: {
          htmlText(token) {
            // Capture before image labels collapse their children into alt text.
            const value = this.resume();
            const node = this.stack[this.stack.length - 1];
            if (node?.type === "html") node.value = value;
            first ??= value;
            this.exit(token);
          },
        },
      },
    ],
  });
  return first;
}
