import assert from "node:assert/strict";
import { loadParserModule } from "./parser-module-probes.mjs";

const point = (offset) => ({
  line: 1,
  column: offset + 1,
  offset,
  _index: 0,
  _bufferIndex: offset,
});
const token = (start, end) => ({
  type: "content",
  start: point(start),
  ...(end === undefined ? {} : { end: point(end) }),
});
const event = (value) => ["enter", value, {}];

export async function lazyLineWork(variant, mutant = "none") {
  const probe = await loadParserModule("document", variant, { lazyMutant: mutant });
  return (count) => {
    const open = token(0);
    const raw = [event(open)];
    const observed = probe.observeEvents(raw);
    const signature = [];
    probe.resetWork();
    for (let line = 1; line <= count; line++) {
      const closed = token(line * 10, line * 10 + 5);
      raw.push(event(closed), ["exit", closed, {}]);
      signature.push(probe.mdrefineContinuesLazy(observed, line * 10));
    }
    const work = probe.workStats.reads + probe.workStats.writes;
    assert.equal(probe.workStats.writes, 0);
    assert(raw[0][1] === open);
    assert.deepEqual(Object.keys(open), ["type", "start"]);
    return { signature, work };
  };
}

export async function verifyLazyLineWitnesses(mutant = "none") {
  const stock = await loadParserModule("document", "stock");
  const fixed = await loadParserModule("document", "fixed", { lazyMutant: mutant });
  const controls = [
    [
      "identity: replaced token",
      (events) => {
        events[0] = event(token(0, 1));
      },
    ],
    [
      "bounds: closed at the boundary",
      (events) => {
        events[0][1].end = point(20);
      },
    ],
    [
      "bounds: closed before the boundary",
      (events) => {
        events[0][1].end = point(10);
      },
    ],
    [
      "bounds: start moved to the boundary",
      (events) => {
        events[0][1].start.offset = 20;
      },
    ],
    [
      "bounds: existing end point changed",
      (events) => {
        events[0][1].end.offset = 20;
      },
    ],
    [
      "identity: array truncated",
      (events) => {
        events.length = 0;
      },
    ],
    [
      "reordered surviving token",
      (events) => {
        events.reverse();
      },
    ],
    [
      "same token in a new tuple",
      (events) => {
        events[0] = ["exit", events[0][1], {}];
      },
    ],
    [
      "fallback finds a different spanning token",
      (events) => {
        events[0][1].end = point(10);
        events.push(event(token(5)));
      },
    ],
  ];
  for (const [label, mutate] of controls) {
    const events = [event(token(0, 100)), event(token(10, 15))];
    assert.equal(fixed.mdrefineContinuesLazy(events, 10), true);
    mutate(events);
    const before = JSON.stringify(events);
    const identities = events.map((entry) => ({
      entry,
      token: entry[1],
      start: entry[1].start,
      end: entry[1].end,
    }));
    assert.equal(
      fixed.mdrefineContinuesLazy(events, 20),
      stock.mdrefineContinuesLazy(events, 20),
      label,
    );
    assert.equal(JSON.stringify(events), before, label + " mutated events");
    identities.forEach((identity, index) => {
      assert(events[index] === identity.entry);
      assert(events[index][1] === identity.token);
      assert(events[index][1].start === identity.start);
      assert(events[index][1].end === identity.end);
    });
  }
  // A miss must not survive a later write, and a different array is not the
  // same stream even if an index happens to be equal.
  const empty = [];
  assert.equal(fixed.mdrefineContinuesLazy(empty, 10), false);
  empty.push(event(token(0)));
  assert.equal(fixed.mdrefineContinuesLazy(empty, 10), true);
  assert.equal(fixed.mdrefineContinuesLazy([event(token(0, 10))], 10), false);
  // Move backwards as well as forwards through offsets while tokens and array
  // membership change. No append-only or monotonic-position assumption applies.
  const changing = [];
  let seed = 796;
  for (let step = 0; step < 256; step++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const offset = seed % 40;
    switch (step % 4) {
      case 0:
        changing.push(event(token(offset, offset + 5)));
        break;
      case 1:
        if (changing.length) changing[seed % changing.length][1].end = undefined;
        break;
      case 2:
        changing.reverse();
        break;
      case 3:
        changing.splice(seed % (changing.length + 1), 1);
        break;
    }
    assert.equal(
      fixed.mdrefineContinuesLazy(changing, offset),
      stock.mdrefineContinuesLazy(changing, offset),
      `changing event stream step ${step}`,
    );
  }
  return { controls: controls.length + 3, mutations: 256 };
}
