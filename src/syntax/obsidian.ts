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
  interface BlockContentMap {
    obsidianComment: ObsidianLiteral;
  }
}
declare module "micromark-util-types" {
  interface TokenTypeMap {
    obsidianLiteral: "obsidianLiteral";
    obsidianBlockComment: "obsidianBlockComment";
    obsidianCommentData: "obsidianCommentData";
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
    if (code === null || (opening !== "%%" && code < 0 && code !== -1 && code !== -2))
      return nok(code);
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

// Standalone comment blocks may cross blank lines. Keep their complete source opaque.
const tokenizeBlockComment: Tokenizer = function (effects, ok, nok) {
  let opened = 0;
  let previous: number | null = null;
  let closed = false;
  const start: State = (code) => {
    if (code !== 37) return nok(code);
    if (opened === 0) {
      effects.enter("obsidianBlockComment");
      effects.enter("obsidianCommentData");
    }
    effects.consume(code);
    opened++;
    return opened === 2 ? body : start;
  };
  const body: State = (code) => {
    if (code === null || (closed && code < -2)) {
      effects.exit("obsidianCommentData");
      effects.exit("obsidianBlockComment");
      return ok(code);
    }
    if (code < -2) {
      effects.exit("obsidianCommentData");
      effects.enter("lineEnding");
      effects.consume(code);
      effects.exit("lineEnding");
      previous = null;
      return before;
    }
    effects.consume(code);
    if (code === 37 && previous === 37) closed = true;
    previous = code;
    return body;
  };
  const before: State = (code) => {
    if (code === null) {
      effects.exit("obsidianBlockComment");
      return ok(code);
    }
    if (code < -2) {
      effects.enter("lineEnding");
      effects.consume(code);
      effects.exit("lineEnding");
      return before;
    }
    effects.enter("obsidianCommentData");
    return body(code);
  };
  return start;
};

export const obsidianSyntax: Extension = {
  flow: { 37: { name: "obsidianBlockComment", tokenize: tokenizeBlockComment, concrete: true } },
  text: Object.fromEntries(
    [33, 91, 37, 61].map((code) => [code, { name: "obsidianLiteral", tokenize }]),
  ),
};
export const obsidianTree: TreeExtension = {
  enter: {
    obsidianBlockComment(token) {
      this.enter({ type: "obsidianComment", value: this.sliceSerialize(token) }, token);
    },
    obsidianLiteral(token) {
      const raw = this.sliceSerialize(token);
      const wiki = raw.startsWith("[[") || raw.startsWith("![[");
      const embed = raw.startsWith("!");
      const value = raw.slice(wiki && embed ? 3 : 2, -2).replaceAll("\\|", "|");
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
    obsidianBlockComment(token) {
      this.exit(token);
    },
    obsidianLiteral(token) {
      this.exit(token);
    },
  },
};
