import type { Nodes, Parents } from "mdast";
import type { Document } from "../core/types.js";
import { leaves } from "./protection-source.js";

/** GitHub's display-math paragraph can carry through a following native heading. */
export function collectGithubMathProtections(document: Document): Set<Nodes> {
  const boundaryText = new Set<Nodes>();
  // GitHub builds display math from paragraphs. A Setext underline below
  // text directly after its closing dollars underlines the whole paragraph,
  // including the dollar lines (#336). Keep that boundary and its content
  // together, including consecutive math blocks and blocks inside containers,
  // or a lazy continuation outside the container ending with that math.
  if (document.dialect === "github") {
    const visitMath = (parent: Parents): Nodes | undefined => {
      let first: Nodes | undefined;
      let previous: Nodes | undefined;
      for (const child of parent.children) {
        const trailing =
          "children" in child && !leaves.has(child.type) ? visitMath(child) : undefined;
        const adjacent =
          previous?.position !== undefined &&
          child.position !== undefined &&
          previous.position.end.line === child.position.start.line - 1;
        if (child.type === "math") {
          if (!adjacent || !first) first = child;
        } else {
          if (
            first?.position &&
            adjacent &&
            child.type === "heading" &&
            child.position!.end.line > child.position!.start.line
          )
            boundaryText.add({
              ...child,
              position: { start: first.position.start, end: child.position!.end },
            });
          first = trailing;
        }
        previous = child;
      }
      // The final math paragraph can continue lazily outside its quote or
      // list item. A physical blank at the container's end stops that carry.
      return previous?.position?.end.line === parent.position?.end.line ? first : undefined;
    };
    visitMath(document.tree);
  }
  return boundaryText;
}
