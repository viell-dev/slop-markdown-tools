// Tiny graph-level proof. All corrections are built by the production builder;
// the stock factories remain the compatibility oracle.
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmAutolinkLiteral } from "micromark-extension-gfm-autolink-literal";
import { gfmStrikethrough } from "micromark-extension-gfm-strikethrough";
import { cjkFriendlyExtension } from "micromark-extension-cjk-friendly";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { bundleParser } from "../scripts/build-parser.mjs";
import { loadParserModule } from "./parser-module-probes.mjs";

const stock = { fromMarkdown, gfm, gfmAutolinkLiteral, gfmStrikethrough, cjkFriendlyExtension };
const sources = [
  "[ " + "some text http and more words here abc@def ".repeat(6),
  "[ some text abc@def http [nested more@host] still@host\n",
  "![ label abc@def and http://example.invalid then @host\n",
  "[closed](https://example.invalid) abc@def http://example.invalid\n",
  "[a][missing] abc@def [b] x@y.invalid\n\n[b]: /url\n",
  "[a *b* ~~c~~ abc@def http://example.invalid](target) after@host\n",
  "[a](target) [ abc@def\n\n[ other@host\n",
  "<https://example.invalid/a> email@example.invalid www.example.invalid\n",
  "漢*字*漢 [ abc@def ~~語~~ http://example.invalid\n",
];

function extensions(lib, mode) {
  if (mode === "standalone")
    return [lib.gfmAutolinkLiteral(), lib.gfmStrikethrough({ singleTilde: false })];
  return [lib.gfm(), ...(mode === "cjk" ? [lib.cjkFriendlyExtension()] : [])];
}

function observer(snapshots) {
  const capture = (events) => {
    // Serializing whole enumerable token records detects added properties and
    // recursive cache values; offsets alone would miss that compatibility break.
    snapshots.push(JSON.stringify(events.map(([event, token]) => [event, token])));
  };
  const construct = {
    previous() {
      capture(this.events);
      return false;
    },
    tokenize(_effects, _ok, nok) {
      capture(this.events);
      return nok;
    },
  };
  const text = {};
  // Literal email scanning starts at the first atext character, not at `@`.
  for (const character of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+-.@_")
    text[character.charCodeAt(0)] = construct;
  return {
    text,
    insideSpan: {
      null: [
        {
          resolveAll(events, context) {
            capture(context.events);
            return events;
          },
        },
      ],
    },
  };
}

export async function verifyAutolinkCompatibility() {
  const { code } = await bundleParser();
  const fixed = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  let cases = 0;
  let observations = 0;
  for (const mode of ["gfm", "cjk", "standalone"])
    for (const source of sources) {
      const snapshots = { stock: [], fixed: [] };
      const tree = {};
      for (const [name, lib] of [
        ["stock", stock],
        ["fixed", fixed],
      ]) {
        tree[name] = lib.fromMarkdown(source, {
          extensions: [
            ...extensions(lib, mode),
            observer(snapshots[name]),
            { disable: { null: ["mdrefineDeferredInline"] } },
          ],
          mdastExtensions: [gfmFromMarkdown()],
        });
      }
      assert.deepEqual(tree.fixed, tree.stock, `AST changed: ${mode}/${source}`);
      const fastTree = fixed.fromMarkdown(source, {
        extensions: extensions(fixed, mode),
        mdastExtensions: [gfmFromMarkdown()],
      });
      assert.deepEqual(fastTree, tree.stock, `Fast-path AST changed: ${mode}/${source}`);
      assert.deepEqual(
        snapshots.fixed,
        snapshots.stock,
        `Token properties changed: ${mode}/${source}`,
      );
      assert(snapshots.fixed.length > 0, "Observer must actually execute");
      observations += snapshots.fixed.length;
      cases++;
    }

  // Inspect real production-transformed previousUnbalanced(), with no copy of
  // its algorithm. Each mutation below invalidates one specific cached claim.
  const module = await loadParserModule("autolink", "fixed");
  const check = module.mdrefineUnbalanced;
  const stockModule = await loadParserModule("autolink", "stock");
  let invalidatedCacheCases = 0;
  const run = (change) => {
    const label = { type: "labelLink", _balanced: false };
    const middle = { type: "data" };
    const tail = { type: "data" };
    const events = [
      ["enter", label],
      ["exit", label],
      ["enter", middle],
      ["exit", middle],
      ["enter", tail],
      ["exit", tail],
    ];
    assert.equal(check(events), true);
    assert.equal(check(events), true);
    for (const token of [label, middle, tail]) {
      assert(!Object.keys(token).some((key) => key.includes("SkipTo")));
      assert.doesNotThrow(() => JSON.stringify(token));
    }
    change({ events, label, middle, tail });
    assert.equal(check(events), false);
    invalidatedCacheCases++;
  };
  run(({ label }) => {
    label._balanced = true;
  }); // cached label is rechecked
  run(({ events }) => {
    events.splice(0, 2);
  }); // cached index now points elsewhere
  run(({ events }) => {
    // same index, different identity
    const balanced = { type: "labelLink", _balanced: true };
    events[0][1] = balanced;
    events[1][1] = balanced;
  });
  run(({ events }) => {
    // stale index lies beyond the current event array
    events.splice(0, 4);
  });
  // A destination can keep its index and identity while losing its positive
  // witness state. Rechecking it only after the jump skips a new middle label.
  // Each replay has fresh tokens: a failed fixed replay can write the stock
  // negative walked-into flag, so sharing token objects would spoil the oracle.
  for (const type of ["labelLink", "labelImage"])
    for (const invalidation of ["balanced", "retyped"]) {
      const replay = (previous) => {
        const label = { type, _balanced: false };
        const middle = { type: "data" };
        const tail = { type: "data" };
        const events = [
          ["enter", label],
          ["exit", label],
          ["enter", middle],
          ["exit", middle],
          ["enter", tail],
          ["exit", tail],
        ];
        assert.equal(previous(events), true);
        assert.equal(previous(events), true);
        if (invalidation === "balanced") label._balanced = true;
        else label.type = "data";
        const intervening = { type, _balanced: false };
        events[2][1] = intervening;
        events[3][1] = intervening;
        assert.equal(events[1][1], label);
        assert.equal(events[5][1], tail);
        return previous(events);
      };
      assert.equal(replay(stockModule.mdrefineUnbalanced), true, type + "/" + invalidation);
      assert.equal(replay(check), true, type + "/" + invalidation);
      invalidatedCacheCases++;
    }
  return {
    sources: sources.length,
    cases,
    astComparisons: cases * 2,
    observations,
    invalidatedCacheCases,
  };
}
