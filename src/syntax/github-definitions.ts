import type { Nodes, Root } from "mdast";
import type { Extension } from "micromark-util-types";

/** Definitions in content interrupted by a table are visible prose on GitHub (#732). */
export function githubTableDefinitions(tree: Root): Set<number> {
  const offsets = new Set<number>();
  function visit(node: Nodes) {
    if (!("children" in node)) return;
    const children = node.children;
    let definitions: number[] = [];
    let end = -1;
    for (const child of children) {
      if (child.position?.start.line !== end + 1) definitions = [];
      if (child.type === "definition") definitions.push(child.position!.start.offset!);
      else if (child.type === "table") {
        for (const offset of definitions) offsets.add(offset);
        definitions = [];
      } else if (child.type !== "paragraph") definitions = [];
      end = child.position?.end.line ?? -1;
      visit(child);
    }
  }
  visit(tree);
  return offsets;
}

/**
 * Reuse the parser's definition tokenizer except at the confirmed content starts.
 * Refusing there lets its ordinary paragraph tokenizer read the original source,
 * including inline markup and references, with unchanged positions. Definitions
 * elsewhere still populate the parser's labels before inline references are read.
 */
export function githubDefinitionSyntax(offsets: ReadonlySet<number>): Extension {
  return {
    disable: { null: ["definition"] },
    contentInitial: {
      91: {
        name: "githubDefinition",
        tokenize(effects, ok, nok) {
          if (offsets.has(this.now().offset)) return nok;
          const constructs = this.parser.constructs.contentInitial[91];
          const definition = (Array.isArray(constructs) ? constructs : [constructs]).find(
            (construct) => construct?.name === "definition",
          );
          return definition ? definition.tokenize.call(this, effects, ok, nok) : nok;
        },
      },
    },
  };
}

/**
 * GitHub reads the definitions at the start of a paragraph when a Setext
 * underline follows them (`===`, `--` or `-`), before the table can interrupt
 * the paragraph, so it keeps them and shows the underline as text. Read without
 * them, the definitions' lines and the underline make a heading instead. Drop
 * the offsets inside such a heading so that those definitions stay; returns
 * whether any were dropped.
 */
export function keepUnderlinedDefinitions(tree: Root, offsets: Set<number>): boolean {
  let dropped = false;
  function visit(node: Nodes) {
    if (node.type === "heading" && offsets.has(node.position!.start.offset!)) {
      for (const offset of offsets)
        if (offset >= node.position!.start.offset! && offset < node.position!.end.offset!) {
          offsets.delete(offset);
          dropped = true;
        }
      return;
    }
    if ("children" in node) for (const child of node.children) visit(child);
  }
  visit(tree);
  return dropped;
}

const visibleDefinitions = new WeakSet<Nodes>();
/** Keep the existing no-separator protection after replacing definitions with prose. */
export function recordGithubDefinitionText(tree: Root, offsets: ReadonlySet<number>): void {
  function visit(node: Nodes) {
    if (node.type === "paragraph" && offsets.has(node.position!.start.offset!))
      visibleDefinitions.add(node);
    if ("children" in node) for (const child of node.children) visit(child);
  }
  visit(tree);
}
export function githubDefinitionText(node: Nodes): boolean {
  return visibleDefinitions.has(node);
}
