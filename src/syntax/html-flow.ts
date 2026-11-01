import { directive } from "micromark-extension-directive";
import { gfmTable } from "micromark-extension-gfm-table";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { mathFromMarkdown } from "mdast-util-math";
import type { Construct } from "micromark-util-types";
import { fromMarkdown, gfmAutolinkLiteral, gfmFootnote } from "./parser.generated.js";
import { math } from "./math.js";

const treeExtensions = gfmFromMarkdown();
// Only compiler events are needed; do not run the legacy autolink transforms.
for (const extension of treeExtensions) delete extension.transforms;

/** Markdownlint reparses HTML flow and inspects its first inline HTML token. */
export function firstHtmlInFlow(source: string): { html: string | undefined; limited: boolean } {
  let first: string | undefined;
  const workLimit = new Error("directive work limit");
  let remaining = Math.max(4096, source.length * 16);
  const directives = directive();
  delete directives.text;
  // Nested containers repeatedly tokenize their bodies. Count that repeated
  // work, including rolled-back reads, without modifying shared constructs.
  const bounded = (construct: Construct): Construct => ({
    ...construct,
    tokenize(effects, ok, nok) {
      return construct.tokenize.call(
        this,
        {
          ...effects,
          consume(code) {
            if (remaining-- <= 0) throw workLimit;
            return effects.consume(code);
          },
        },
        ok,
        nok,
      );
    },
  });
  directives.flow = Object.fromEntries(
    Object.entries(directives.flow ?? {}).map(([marker, constructs]) => [
      marker,
      constructs
        ? (Array.isArray(constructs) ? constructs : [constructs]).map(bounded)
        : constructs,
    ]),
  );
  try {
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
  } catch (error) {
    if (error !== workLimit) throw error;
    return { html: undefined, limited: true };
  }
  return { html: first, limited: false };
}
