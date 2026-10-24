// Deterministic exposed-tokenizer mechanism probe, not a micromark/public-parse substitute.
// No imports or product execution occur until a caller supplies the actual extension.
import assert from "node:assert/strict";

export function literalWork(extension, source, attempts) {
  let cursor = 0;
  let consumed = 0;
  let states = 0;
  let calls = 0;
  const outcomes = [];
  // Keep one real identity for all attempts in this tokenizer. Recreating this
  // object per attempt would defeat a WeakMap cache and invalidate the probe.
  const context = { now: () => ({ offset: cursor, line: 1, column: cursor + 1 }) };
  const codeAt = () => {
    if (cursor === source.length) return null;
    if (source.startsWith("\r\n", cursor)) return -3;
    if (source[cursor] === "\n") return -4;
    if (source[cursor] === "\r") return -5;
    return source.charCodeAt(cursor);
  };
  // These mechanism fixtures are ASCII. They do not model Unicode preprocessing.
  const positions =
    attempts ??
    Array.from(source, (_, index) => index).filter(
      (index) => source[index] === "[" || source[index] === "!",
    );
  for (const start of positions) {
    cursor = start;
    const code = codeAt();
    const entry = extension.text?.[code];
    const construct = Array.isArray(entry) ? entry[0] : entry;
    assert.equal(construct?.name, "obsidianLiteral");
    let accepted = false;
    let rejected = false;
    const effects = {
      enter() {
        return {};
      },
      exit() {
        return {};
      },
      consume(value) {
        assert.equal(value, codeAt());
        consumed++;
        cursor += value === -3 ? 2 : 1;
      },
    };
    const ok = () => {
      accepted = true;
      return undefined;
    };
    const nok = () => {
      rejected = true;
      return undefined;
    };
    let state = construct.tokenize.call(context, effects, ok, nok);
    calls++;
    while (state) {
      states++;
      assert(
        states <= (source.length + 3) * calls,
        "State schedule exceeded a full-source attempt",
      );
      state = state(codeAt());
    }
    assert.notEqual(accepted, rejected);
    outcomes.push({ start, accepted, ...(accepted ? { end: cursor } : {}) });
  }
  return { consumed, states, calls, outcomes };
}
