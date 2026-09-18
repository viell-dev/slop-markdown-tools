import type { Literal } from "mdast";
import type { Extension, State, Tokenizer } from "micromark-util-types";
import type { Extension as TreeExtension } from "mdast-util-from-markdown";

export interface ObsidianLiteral extends Literal {
  type: "wikiLink" | "obsidianComment" | "obsidianHighlight";
  embed?: boolean;
  target?: string;
  label?: string;
}
declare module "mdast" {
  interface RootContentMap {
    wikiLink: ObsidianLiteral;
    obsidianComment: ObsidianLiteral;
    obsidianHighlight: ObsidianLiteral;
  }
  interface PhrasingContentMap {
    wikiLink: ObsidianLiteral;
    obsidianComment: ObsidianLiteral;
    obsidianHighlight: ObsidianLiteral;
  }
}
declare module "micromark-util-types" {
  interface TokenTypeMap {
    obsidianLiteral: "obsidianLiteral";
  }
}

/** A tokenizer, not a pre-parse replacement: code, escapes, and fenced blocks stay opaque. */
const tokenize: Tokenizer = function (effects, ok, nok) {
  let opening = "";
  let closing = "";
  let index = 0;
  let previous: number | null = null;
  let count = 0;
  const start: State = (code) => {
    opening = code === 33 ? "![[" : code === 91 ? "[[" : code === 37 ? "%%" : "==";
    closing = opening.endsWith("[[") ? "]]" : opening;
    effects.enter("obsidianLiteral");
    return open(code);
  };
  const open: State = (code) => {
    if (code !== opening.charCodeAt(index)) return nok(code);
    effects.consume(code);
    index++;
    return index === opening.length ? body : open;
  };
  const body: State = (code) => {
    if (code === null || (code < 0 && code !== -1 && code !== -2)) return nok(code);
    effects.consume(code);
    count++;
    if (code === closing.charCodeAt(1) && previous === closing.charCodeAt(0)) {
      if (count <= 2) return nok(code);
      effects.exit("obsidianLiteral");
      return ok;
    }
    previous = code;
    return body;
  };
  return start;
};

export const obsidianSyntax: Extension = {
  text: Object.fromEntries(
    [33, 91, 37, 61].map((code) => [code, { name: "obsidianLiteral", tokenize }]),
  ),
};
export const obsidianTree: TreeExtension = {
  enter: {
    obsidianLiteral(token) {
      const raw = this.sliceSerialize(token);
      const wiki = raw.startsWith("[[") || raw.startsWith("![[");
      const embed = raw.startsWith("!");
      const value = raw.slice(wiki && embed ? 3 : 2, -2);
      const divider = value.indexOf("|");
      const node: ObsidianLiteral = {
        type: wiki ? "wikiLink" : raw.startsWith("%%") ? "obsidianComment" : "obsidianHighlight",
        value,
      };
      if (wiki) {
        node.embed = embed;
        node.target = divider < 0 ? value : value.slice(0, divider);
        if (divider >= 0) node.label = value.slice(divider + 1);
      }
      this.enter(node, token);
    },
  },
  exit: {
    obsidianLiteral(token) {
      this.exit(token);
    },
  },
};
