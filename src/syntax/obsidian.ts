import type { Literal } from "mdast";
import type { Extension, State, Tokenizer } from "micromark-util-types";
import type { Extension as TreeExtension } from "mdast-util-from-markdown";

/** An Obsidian wikilink, `[[target|label]]`, or embed, `![[target]]`, in the Obsidian dialect. */
export interface WikiLink extends Literal {
  type: "wikiLink";
  /** The text between the brackets, with `\|` read as `|`. */
  value: string;
  /** Whether it is an embed, written with `!` before the brackets. */
  embed: boolean;
  /** The part before the first `|`: a note name or path, and an optional `#heading` or `#^block`. */
  target: string;
  /** The part after the first `|`, when there is one. */
  label?: string;
}
/**
 * An Obsidian comment in the Obsidian dialect. `value` is the text between the
 * `%%` markers of a comment in running text, and the whole source of a comment
 * that stands as a block of its own, markers included.
 */
export interface ObsidianComment extends Literal {
  type: "obsidianComment";
}
/** An Obsidian highlight, `==text==`, in the Obsidian dialect. `value` is the text between the markers. */
export interface ObsidianHighlight extends Literal {
  type: "obsidianHighlight";
}
declare module "mdast" {
  interface RootContentMap {
    wikiLink: WikiLink;
    obsidianComment: ObsidianComment;
    obsidianHighlight: ObsidianHighlight;
  }
  interface PhrasingContentMap {
    wikiLink: WikiLink;
    obsidianComment: ObsidianComment;
    obsidianHighlight: ObsidianHighlight;
  }
  interface BlockContentMap {
    obsidianComment: ObsidianComment;
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
    effects.enter("obsidianCommentData");
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
    if (code < -2) {
      // Micromark subtokenizes each physical line separately. Expose every
      // line ending so a multiline inline comment can span more than two chunks.
      effects.exit("obsidianCommentData");
      effects.enter("lineEnding");
      effects.consume(code);
      effects.exit("lineEnding");
      previous = null;
      count++;
      return resume;
    }
    effects.consume(code);
    count++;
    if (code === closing.charCodeAt(1) && previous === closing.charCodeAt(0)) {
      if (count <= 2) return nok(code);
      effects.exit("obsidianCommentData");
      effects.exit("obsidianLiteral");
      return ok;
    }
    previous = code;
    return body;
  };
  const resume: State = (code) => {
    effects.enter("obsidianCommentData");
    return body(code);
  };
  return start;
};

// Standalone comment blocks may cross blank lines. Keep their complete source opaque.
// Obsidian reads a comment as inline wherever a paragraph is open, so one that
// would interrupt a paragraph, or that text follows on the line where it
// closes, is left to the inline construct and continues the paragraph (#357).
const tokenizeBlockComment: Tokenizer = function (effects, ok, nok) {
  const interrupt = this.interrupt;
  let opened = 0;
  let previous: number | null = null;
  let closed = false;
  const start: State = (code) => {
    if (code !== 37 || interrupt) return nok(code);
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
    // Only blank space may follow the closing `%%` on its line.
    if (closed && code !== 32 && code !== -1 && code !== -2) return nok(code);
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
      const node: WikiLink | ObsidianComment | ObsidianHighlight = wiki
        ? {
            type: "wikiLink",
            value,
            embed,
            target: divider < 0 ? value : value.slice(0, divider),
            ...(divider >= 0 ? { label: value.slice(divider + 1) } : {}),
          }
        : { type: raw.startsWith("%%") ? "obsidianComment" : "obsidianHighlight", value };
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
