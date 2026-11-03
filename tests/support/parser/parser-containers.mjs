import assert from "node:assert/strict";
import { parse, postprocess, preprocess } from "micromark";
import { gfm } from "micromark-extension-gfm";
import { loadParserModule } from "./parser-module-probes.mjs";

export const builtinContainers = { disable: { null: ["mdrefineBuiltinContainers"] } };
export const originalContainers = {
  disable: { null: ["mdrefineBuiltinContainers", "mdrefineOriginalContainers"] },
};
export const nestedList = (count) =>
  Array.from({ length: count }, (_, index) => " ".repeat(2 * index) + "- x").join("\n") +
  "\n<h1>\n";

/** @param {string} source @param {import("micromark-util-types").Extension} [extension] */
export function rawContainerEvents(source, extension = builtinContainers) {
  return postprocess(
    parse({ extensions: [gfm(), extension] })
      .document()
      .write(preprocess()(source, undefined, true)),
  );
}

/** Drive the pinned blank grammar with check's cursor/event restoration. */
export async function blankLineDriver(variant) {
  const probe = await loadParserModule("blankLine", variant);
  return (codes, disabled = ["mdrefineBuiltinContainers"]) => {
    let cursor = 0;
    let consumed = 0;
    let checks = 0;
    const events = [];
    // Virtual tab codes can share a source offset, but never a chunk cursor.
    const point = () => ({
      line: codes.slice(0, cursor).filter((code) => [-3, -4, -5].includes(code)).length + 1,
      column: cursor + 1,
      offset: codes.slice(0, cursor).filter((code) => code !== -1).length,
      _index: 0,
      _bufferIndex: cursor,
    });
    const context = { now: point, parser: { constructs: { disable: { null: disabled } } } };
    const effects = {
      enter(type) {
        const token = { type, start: point() };
        events.push(token);
        return token;
      },
      exit() {
        return events.at(-1);
      },
      consume(code) {
        assert.equal(code, codes[cursor] ?? null);
        consumed++;
        cursor++;
      },
      check(construct, ok, nok) {
        return (code) => {
          checks++;
          const saved = cursor;
          const size = events.length;
          let result;
          const finish = (value) => () => {
            result = value;
          };
          let state = construct.tokenize.call(context, effects, finish(true), finish(false));
          state = state(code);
          while (result === undefined) {
            assert.equal(typeof state, "function", "blank check stopped without a result");
            state = state(codes[cursor] ?? null);
          }
          cursor = saved;
          events.length = size;
          return (result ? ok : nok)(codes[cursor] ?? null);
        };
      },
    };
    return {
      check(at) {
        cursor = at;
        let result;
        const before = point();
        probe.mdrefineCheckBlankLine.call(
          context,
          effects,
          () => (result = true),
          () => (result = false),
        )(codes[cursor] ?? null);
        assert.deepEqual(point(), before, "check changed the caller's cursor");
        assert.equal(events.length, 0, "check leaked temporary events");
        return result;
      },
      work: () => ({ consumed, checks }),
    };
  };
}

/** Actual fragment, with no hand-maintained second preparation algorithm. */
export async function listPreparer() {
  return (await loadParserModule("footnote", "fixed")).mdrefinePrepareLists;
}
