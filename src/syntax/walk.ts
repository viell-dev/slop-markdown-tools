import type { Nodes, Parents } from "mdast";

type Visitor<T extends Nodes> = (
  node: T,
  index: number | undefined,
  parent: Parents | undefined,
) => void;

/** Pre-order traversal without per-node closure allocation; the root is visited too. */
export function walk(tree: Nodes, visitor: Visitor<Nodes>): void;
export function walk<T extends Nodes["type"]>(
  tree: Nodes,
  type: T,
  visitor: Visitor<Extract<Nodes, { type: T }>>,
): void;
export function walk(
  tree: Nodes,
  typeOrVisitor: string | Visitor<Nodes>,
  maybeVisitor?: Visitor<never>,
): void {
  const type = typeof typeOrVisitor === "string" ? typeOrVisitor : undefined;
  const visitor = (
    typeof typeOrVisitor === "string" ? maybeVisitor : typeOrVisitor
  ) as Visitor<Nodes>;
  const step = (node: Nodes, index: number | undefined, parent: Parents | undefined) => {
    if (type === undefined || node.type === type) visitor(node, index, parent);
    if ("children" in node) {
      const children = node.children;
      for (let i = 0; i < children.length; i++) step(children[i]!, i, node);
    }
  };
  step(tree, undefined, undefined);
}
