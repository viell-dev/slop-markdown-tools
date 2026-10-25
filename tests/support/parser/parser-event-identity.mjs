import assert from "node:assert/strict";
import { loadParserModule } from "./parser-module-probes.mjs";

function fixture() {
  let offset = 0;
  const context = {
    parser: { constructs: { disable: { null: [] }, insideSpan: { null: [] } } },
    sliceSerialize: (token) => (token.type === "strikethroughSequenceTemporary" ? "~~" : "*"),
  };
  const point = (at) => ({ line: 1, column: at + 1, offset: at, _index: 0, _bufferIndex: at });
  const pair = (type, flags = {}) => {
    const token = { type, start: point(offset), end: point(++offset), ...flags };
    return [
      ["enter", token, context],
      ["exit", token, context],
    ];
  };
  return { context, pair };
}

function identicalEvents(actual, expected) {
  assert.equal(actual.length, expected.length);
  for (let index = 0; index < actual.length; index++) assert.equal(actual[index], expected[index]);
}

export async function verifyEventIdentity() {
  let cases = 0;
  const oldEdit = await loadParserModule("editMap", "stock");
  const newEdit = await loadParserModule("editMap", "fixed");
  const { pair } = fixture();
  const original = Array.from({ length: 4 }, () => pair("data")).flat();
  const additions = [pair("data"), pair("data"), pair("data")];
  const batches = [
    [],
    [["add", 0, 0, 0]],
    [["add", original.length, 0, 0]],
    [["add", 2, 2, 0]],
    [
      ["add", 1, 2, 0],
      ["add", 5, 1, 1],
    ],
    [
      ["add", 2, 1, 0],
      ["addBefore", 2, 1, 1],
      ["add", 2, 0, 2],
    ],
  ];
  for (const batch of batches) {
    const oldEvents = original.slice();
    const newEvents = original.slice();
    for (const [module, events] of [
      [oldEdit, oldEvents],
      [newEdit, newEvents],
    ]) {
      const changes = new module.EditMap();
      for (const [method, at, remove, addition] of batch)
        changes[method](at, remove, additions[addition].slice());
      changes.consume(events);
      const beforeSecondConsume = events.slice();
      changes.consume(events); // changes are reset after consumption
      identicalEvents(events, beforeSecondConsume);
    }
    identicalEvents(newEvents, oldEvents); // all surviving and inserted event identities
    cases++;
  }

  {
    const module = await loadParserModule("text", "fixed");
    const { pair, context } = fixture();
    const prefix = pair("characterEscape"),
      suffix = pair("characterEscape");
    const first = pair("data"),
      middle = pair("data"),
      last = pair("data");
    const events = [...prefix, ...first, ...middle, ...last, ...suffix];
    const start = first[0][1].start,
      end = last[0][1].end;
    assert.equal(module.resolver.resolveAll(events, context), events);
    identicalEvents(events, [...prefix, ...first, ...suffix]);
    assert.equal(first[0][1].start, start);
    assert.equal(first[0][1].end, end);
    cases++;
  }
  {
    const module = await loadParserModule("code", "fixed");
    const { pair, context } = fixture();
    const group = pair("codeText"),
      open = pair("codeTextSequence"),
      close = pair("codeTextSequence");
    const first = pair("codeTextData"),
      second = pair("space"),
      newline = pair("lineEnding");
    const third = pair("codeTextData"),
      fourth = pair("codeTextData");
    const events = [
      group[0],
      ...open,
      ...first,
      ...second,
      ...newline,
      ...third,
      ...fourth,
      ...close,
      group[1],
    ];
    const firstEnd = second[0][1].end,
      thirdEnd = fourth[0][1].end;
    assert.equal(module.codeText.resolve(events, context), events);
    identicalEvents(events, [
      group[0],
      ...open,
      ...first,
      ...newline,
      ...third,
      ...close,
      group[1],
    ]);
    assert.equal(first[0][1].end, firstEnd);
    assert.equal(third[0][1].end, thirdEnd);
    cases++;
  }
  for (const kind of ["attention", "strike"]) {
    const module = await loadParserModule(kind, "fixed");
    const { pair, context } = fixture();
    const type = kind === "attention" ? "attentionSequence" : "strikethroughSequenceTemporary";
    const events = [
      ...pair("data"),
      ...pair(type, { _open: false, _close: true }),
      ...pair("data"),
      ...pair(type, { _open: false, _close: true }),
    ];
    const identities = events.slice();
    const endpoints = events.map(([, token]) => [token.start, token.end]);
    const resolver =
      kind === "attention"
        ? module.mdrefineResolveAttention
        : module.gfmStrikethrough().insideSpan.null[0].resolveAll;
    assert.equal(resolver(events, context), events);
    identicalEvents(events, identities);
    events.forEach(([, token], index) => {
      assert.equal(token.start, endpoints[index][0]);
      assert.equal(token.end, endpoints[index][1]);
    });
    cases++;
  }
  return { cases };
}
