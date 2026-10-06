/*
 * Dollar math for micromark: `$…$` and `$$…$$` in running text, and blocks
 * fenced by `$$` lines.
 *
 * Adapted from micromark-extension-math 3.1.0, copyright (c) 2020 Titus Wormer,
 * used under the MIT license; see THIRD_PARTY_NOTICES in the package. That
 * package exports its tokenizer only together with a KaTeX renderer, which
 * this tool has no use for, and it has no conditions on where math in text may
 * begin and end. The conditions below are what the renderers were seen to apply.
 */
import { factorySpace } from "micromark-factory-space";
import { asciiAlphanumeric, markdownLineEnding, markdownSpace } from "micromark-util-character";
import type {
  Code,
  Construct,
  Extension,
  Previous,
  Resolver,
  State,
  Token,
  Tokenizer,
} from "micromark-util-types";

declare module "micromark-util-types" {
  interface TokenTypeMap {
    mathFlow: "mathFlow";
    mathFlowFence: "mathFlowFence";
    mathFlowFenceMeta: "mathFlowFenceMeta";
    mathFlowFenceSequence: "mathFlowFenceSequence";
    mathFlowValue: "mathFlowValue";
    mathText: "mathText";
    mathTextData: "mathTextData";
    mathTextPadding: "mathTextPadding";
    mathTextSequence: "mathTextSequence";
  }
}

/**
 * How much a renderer asks of `$…$` in running text before it is math. Each
 * level only refuses what its renderers were verified to refuse, so that the
 * tool reads as math at least what they render as math: text wrongly taken for
 * math is merely left alone, while a formula taken for prose could be rewrapped
 * or restyled.
 *
 * - `loose`: any text between two runs of as many dollars, as a code span is
 *   delimited by backticks. For Obsidian, whose conditions are not verified.
 * - `bounded`: the opening dollars do not follow a letter or digit, the formula
 *   ends at the next dollars, and those are not followed by a letter, a digit,
 *   or an underscore. Otherwise there is no formula. Forgejo and Gitea.
 * - `tight`: as `bounded`, and a single dollar hugs the formula: no space or
 *   line ending after the opening one, no space before the closing one. GitHub.
 */
export type MathConditions = "loose" | "bounded" | "tight";

const dollar = 36;
const backslash = 92;
const underscore = 95;

function mathText(conditions: MathConditions): Construct {
  const strict = conditions !== "loose";
  const previous: Previous = function (code) {
    // Like a code span, math does not start in the middle of a run of dollars,
    // unless the dollar before was escaped. Forgejo and Gitea do start it there
    // when the run as a whole opened nothing: `$$x$` is a dollar and `$x$`.
    if (
      code === dollar &&
      conditions !== "bounded" &&
      this.events[this.events.length - 1]?.[1].type !== "characterEscape"
    )
      return false;
    return !strict || !asciiAlphanumeric(code);
  };
  const tokenize: Tokenizer = function (effects, ok, nok) {
    let sizeOpen = 0;
    let size = 0;
    let token: Token;
    // The character before the current one, to judge a closing dollar by.
    let before: Code = null;
    /** Whether a single dollar must hug the formula, as on GitHub. */
    const hugging = () => conditions === "tight" && sizeOpen === 1;

    const start: State = (code) => {
      effects.enter("mathText");
      effects.enter("mathTextSequence");
      return sequenceOpen(code);
    };
    const sequenceOpen: State = (code) => {
      if (code === dollar) {
        effects.consume(code);
        sizeOpen++;
        return sequenceOpen;
      }
      effects.exit("mathTextSequence");
      if (hugging() && (markdownSpace(code) || markdownLineEnding(code))) return nok(code);
      before = dollar;
      return between(code);
    };
    const between: State = (code) => {
      if (code === null) return nok(code);
      if (code === dollar) {
        token = effects.enter("mathTextSequence");
        size = 0;
        return strict ? sequenceCloseStrict(code) : sequenceClose(code);
      }
      // Tabs don't work, and virtual spaces don't make sense.
      if (code === 32) {
        effects.enter("space");
        effects.consume(code);
        effects.exit("space");
        before = code;
        return between;
      }
      if (markdownLineEnding(code)) {
        effects.enter("lineEnding");
        effects.consume(code);
        effects.exit("lineEnding");
        before = code;
        return between;
      }
      effects.enter("mathTextData");
      return data(code);
    };
    const data: State = (code) => {
      if (code === null || code === 32 || code === dollar || markdownLineEnding(code)) {
        effects.exit("mathTextData");
        return between(code);
      }
      effects.consume(code);
      before = code;
      // Forgejo and Gitea keep an escaped dollar in the formula. For GitHub an
      // escaped dollar is a dollar like any other, and ends it.
      return conditions === "bounded" && code === backslash ? escaped : data;
    };
    const escaped: State = (code) => {
      // A backslash takes a dollar or another backslash with it; before anything
      // else it is an ordinary character.
      if (code !== dollar && code !== backslash) return data(code);
      effects.consume(code);
      before = code;
      return data;
    };
    /** Any text up to a run of exactly as many dollars as opened the math. */
    const sequenceClose: State = (code) => {
      if (code === dollar) {
        effects.consume(code);
        size++;
        return sequenceClose;
      }
      if (size === sizeOpen) {
        effects.exit("mathTextSequence");
        effects.exit("mathText");
        return ok(code);
      }
      // More or fewer dollars: they are part of the math.
      token.type = "mathTextData";
      return data(code);
    };
    /** The formula ends at the next dollars; what surrounds them decides whether it was one. */
    const sequenceCloseStrict: State = (code) => {
      if (code === dollar && size < sizeOpen) {
        effects.consume(code);
        size++;
        return sequenceCloseStrict;
      }
      if (size < sizeOpen) {
        // A single dollar between doubled ones: no renderer was seen to end there.
        token.type = "mathTextData";
        before = dollar;
        return data(code);
      }
      if (asciiAlphanumeric(code) || code === underscore) return nok(code);
      if (hugging() && markdownSpace(before)) return nok(code);
      effects.exit("mathTextSequence");
      effects.exit("mathText");
      return ok(code);
    };
    return start;
  };
  return { tokenize, resolve: resolveMathText, previous, name: "mathText" };
}

/** Marks padding and merges adjacent spaces and data, as for a code span. */
const resolveMathText: Resolver = (events) => {
  let tailExitIndex = events.length - 4;
  let headEnterIndex = 3;
  const type = (index: number) => events[index]![1].type;
  // If we start and end with an EOL or a space.
  if (
    (type(headEnterIndex) === "lineEnding" || type(headEnterIndex) === "space") &&
    (type(tailExitIndex) === "lineEnding" || type(tailExitIndex) === "space")
  ) {
    let index = headEnterIndex;
    // And we have data.
    while (++index < tailExitIndex) {
      if (type(index) === "mathTextData") {
        // Then we have padding.
        events[tailExitIndex]![1].type = "mathTextPadding";
        events[headEnterIndex]![1].type = "mathTextPadding";
        headEnterIndex += 2;
        tailExitIndex -= 2;
        break;
      }
    }
  }
  // Merge adjacent spaces and data.
  let index = headEnterIndex - 1;
  let enter: number | undefined;
  tailExitIndex++;
  while (++index <= tailExitIndex) {
    if (enter === undefined) {
      if (index !== tailExitIndex && type(index) !== "lineEnding") enter = index;
    } else if (index === tailExitIndex || type(index) === "lineEnding") {
      events[enter]![1].type = "mathTextData";
      if (index !== enter + 2) {
        events[enter]![1].end = events[index - 1]![1].end;
        events.splice(enter + 2, index - enter - 2);
        tailExitIndex -= index - enter - 2;
        index = enter + 2;
      }
      enter = undefined;
    }
  }
  return events;
};

const tokenizeNonLazyContinuation: Tokenizer = function (effects, ok, nok) {
  const start: State = (code) => {
    if (code === null) return ok(code);
    effects.enter("lineEnding");
    effects.consume(code);
    effects.exit("lineEnding");
    return lineStart;
  };
  const lineStart: State = (code) => (this.parser.lazy[this.now().line] ? nok(code) : ok(code));
  return start;
};
const nonLazyContinuation: Construct = { tokenize: tokenizeNonLazyContinuation, partial: true };

/** A block of math between two lines of at least two dollars, like fenced code. */
const tokenizeMathFenced: Tokenizer = function (effects, ok, nok) {
  const { parser } = this;
  const tail = this.events[this.events.length - 1];
  const initialSize =
    tail && tail[1].type === "linePrefix" ? tail[2].sliceSerialize(tail[1], true).length : 0;
  let sizeOpen = 0;

  const start: State = (code) => {
    effects.enter("mathFlow");
    effects.enter("mathFlowFence");
    effects.enter("mathFlowFenceSequence");
    return sequenceOpen(code);
  };
  const sequenceOpen: State = (code) => {
    if (code === dollar) {
      effects.consume(code);
      sizeOpen++;
      return sequenceOpen;
    }
    if (sizeOpen < 2) return nok(code);
    effects.exit("mathFlowFenceSequence");
    return factorySpace(effects, metaBefore, "whitespace")(code);
  };
  const metaBefore: State = (code) => {
    if (code === null || markdownLineEnding(code)) return metaAfter(code);
    effects.enter("mathFlowFenceMeta");
    effects.enter("chunkString", { contentType: "string" });
    return meta(code);
  };
  const meta: State = (code) => {
    if (code === null || markdownLineEnding(code)) {
      effects.exit("chunkString");
      effects.exit("mathFlowFenceMeta");
      return metaAfter(code);
    }
    if (code === dollar) return nok(code);
    effects.consume(code);
    return meta;
  };
  const metaAfter: State = (code) => {
    // Guaranteed to be at the end of the line or of the document.
    effects.exit("mathFlowFence");
    if (this.interrupt) return ok(code);
    return effects.attempt(nonLazyContinuation, beforeNonLazyContinuation, after)(code);
  };
  const beforeNonLazyContinuation: State = (code) =>
    effects.attempt({ tokenize: tokenizeClosingFence, partial: true }, after, contentStart)(code);
  const contentStart: State = (code) =>
    (initialSize
      ? factorySpace(effects, beforeContentChunk, "linePrefix", initialSize + 1)
      : beforeContentChunk)(code);
  const beforeContentChunk: State = (code) => {
    if (code === null) return after(code);
    if (markdownLineEnding(code))
      return effects.attempt(nonLazyContinuation, beforeNonLazyContinuation, after)(code);
    effects.enter("mathFlowValue");
    return contentChunk(code);
  };
  const contentChunk: State = (code) => {
    if (code === null || markdownLineEnding(code)) {
      effects.exit("mathFlowValue");
      return beforeContentChunk(code);
    }
    effects.consume(code);
    return contentChunk;
  };
  const after: State = (code) => {
    effects.exit("mathFlow");
    return ok(code);
  };
  const tokenizeClosingFence: Tokenizer = (effects, ok, nok) => {
    let size = 0;
    const beforeSequenceClose: State = (code) => {
      effects.enter("mathFlowFence");
      effects.enter("mathFlowFenceSequence");
      return sequenceClose(code);
    };
    const sequenceClose: State = (code) => {
      if (code === dollar) {
        size++;
        effects.consume(code);
        return sequenceClose;
      }
      if (size < sizeOpen) return nok(code);
      effects.exit("mathFlowFenceSequence");
      return factorySpace(effects, afterSequenceClose, "whitespace")(code);
    };
    const afterSequenceClose: State = (code) => {
      if (code === null || markdownLineEnding(code)) {
        effects.exit("mathFlowFence");
        return ok(code);
      }
      return nok(code);
    };
    return factorySpace(
      effects,
      beforeSequenceClose,
      "linePrefix",
      parser.constructs.disable.null?.includes("codeIndented") ? undefined : 4,
    );
  };
  return start;
};
const mathFlow: Construct = { tokenize: tokenizeMathFenced, concrete: true, name: "mathFlow" };

/** The micromark syntax for dollar math, with the conditions of one renderer for math in text. */
export function math(conditions: MathConditions): Extension {
  return { flow: { [dollar]: mathFlow }, text: { [dollar]: mathText(conditions) } };
}
