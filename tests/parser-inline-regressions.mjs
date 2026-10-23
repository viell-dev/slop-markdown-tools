import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { cjkFriendlyExtension } from "micromark-extension-cjk-friendly";
import { toHast } from "mdast-util-to-hast";
import { toHtml } from "hast-util-to-html";
import { bundleParser } from "../scripts/build-parser.mjs";
import { loadParserModule } from "./parser-module-probes.mjs";

// Actual production builder/repairs; no copied implementation of a resolver.
// The cache is local to these test helpers, not a product source/tree cache.
let generated;
const modules = new Map();
export function generatedInlineParser() {
  return (generated ??= bundleParser().then(
    ({ code }) => import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`),
  ));
}
function correctedModule(kind, variant) {
  const key = `${kind}/${variant}`;
  if (!modules.has(key)) modules.set(key, loadParserModule(kind, variant));
  return modules.get(key);
}

/** Focused families ported from remaining-inline-performance-probe.mjs. */
export function inlineSources(specifications) {
  const sources = new Set([
    "see `x` and ".repeat(8),
    "see *x* and ".repeat(8),
    "see ~~x~~ and ".repeat(8),
    '*a [x](y) b* _a [x][r] b_\n\n[r]: /url "title"\n',
    "**a ![x](y) b** __a ![x][r] b__\n\n[r]: /url\n",
    "*a[^b] c*\n\n[^b]: **note** and ~~deleted~~\n",
    "*a ~~b* c~~ d* ~~a *b~~ c*\n",
    "> *a\n> b*\n\n- **c\n  d**\n",
    "| *a* | **b** |\n| --- | --- |\n| ***c*** | _d_ |\n",
    "*a &amp; b* *a\\*b* *a `*` b*\n",
    "*a\r\n b* __c\td__ *é🧩漢*\n",
    "[a *b*](c) *[a](b)* ![*a*](b)\n",
    "[a *b*][ref]\n\n[ref]: /url\n",
    "<span>*a*</span> *<span>b</span>*\n",
    "漢**強調**字 A**強調**B 「**強調**」\n",
    "漢*字*漢 ~~漢*字*漢~~ **漢~~字~~漢**\n",
    "漢*字*𠮷 **漢𠮷**字 「_語_」\n",
    "Text ` \n   foo ` and `\tbar\t` end.\n",
    "> Run `npm run\r\n   build` now.\r\n",
    "![before `code\nspan` after](image.png) tail\n",
    "[before `` code\nspan `` after][r]\n\n[r]: /url\n",
  ]);
  const delimiters = ["*", "_"].flatMap((marker) =>
    Array.from({ length: 6 }, (_, index) => marker.repeat(index + 1)),
  );
  for (const a of delimiters)
    for (const b of delimiters) {
      sources.add(`${a}a${b} x ${b}b${a}\n`);
      sources.add(`a${a}b ${b}c ${a}d${b}e\n`);
      sources.add(`${a}a ${b}b${a} c${b}\n`);
    }
  const sections = new Set([
    "Emphasis and strong emphasis",
    "Links",
    "Images",
    "Link reference definitions",
    "Backslash escapes",
    "Code spans",
  ]);
  for (const item of specifications) if (sections.has(item.section)) sources.add(item.markdown);
  // Bounded LCG corpus using high bits; it differs from the retained low-bit proof.
  const parts = [
    "a",
    "b",
    "*",
    "**",
    "***",
    "_",
    "__",
    "___",
    " ",
    ".",
    "(",
    ")",
    "[x](u)",
    "`*`",
    "~",
    "~~",
    "\n",
    "漢",
    "&amp;",
    "\\*",
  ];
  let seed = 151;
  for (let fixture = 0; fixture < 96; fixture++) {
    let source = "";
    for (let token = 0; token < 20; token++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      source += parts[(seed >>> 16) % parts.length];
    }
    sources.add(source);
  }
  return [...sources];
}

function syntax(lib, mode) {
  return mode === "commonmark"
    ? []
    : [lib.gfm(), ...(mode === "cjk" ? [lib.cjkFriendlyExtension()] : [])];
}
function options(lib, mode, compatibility = false) {
  return {
    extensions: [
      ...syntax(lib, mode),
      ...(compatibility ? [{ disable: { null: ["mdrefineDeferredInline"] } }] : []),
    ],
    ...(mode === "commonmark" ? {} : { mdastExtensions: [gfmFromMarkdown()] }),
  };
}
function html(tree) {
  return toHtml(toHast(tree, { allowDangerousHtml: true }), { allowDangerousHtml: true });
}

/** Raw generated factory checks; this is not a public parse() wiring test. */
export async function verifyInlineMatrix(mode, sources) {
  const fixed = await generatedInlineParser();
  const stock = { fromMarkdown, gfm, cjkFriendlyExtension };
  let astComparisons = 0;
  let htmlComparisons = 0;
  for (const source of sources) {
    const expected = stock.fromMarkdown(source, options(stock, mode));
    const expectedHtml = html(expected);
    for (const compatibility of [false, true]) {
      const label = `${mode}/${compatibility ? "compatibility" : "fast"}/${JSON.stringify(source)}`;
      const actual = fixed.fromMarkdown(source, options(fixed, mode, compatibility));
      assert.deepEqual(actual, expected, `Complete AST/positions changed: ${label}`);
      astComparisons++;
      assert.equal(html(actual), expectedHtml, `AST-derived HTML changed: ${label}`);
      htmlComparisons++;
    }
  }
  return { sources: sources.length, astComparisons, htmlComparisons };
}

function eventFixture(specs, resolver, compatibility = false, observe = (events) => events) {
  let offset = 0;
  const markers = new WeakMap();
  const named = new Map();
  const context = {
    parser: {
      constructs: {
        disable: { null: compatibility ? ["mdrefineDeferredInline"] : [] },
        insideSpan: { null: [{ resolveAll: resolver }] },
      },
    },
    sliceSerialize(token) {
      return (markers.get(token) ?? "x").repeat(token.end.offset - token.start.offset);
    },
  };
  const point = (at) => ({ line: 1, column: at + 1, offset: at, _index: 0, _bufferIndex: at });
  const raw = specs.flatMap(({ name, type = "data", marker = "x", width = 1, ...flags }) => {
    const token = { type, start: point(offset), end: point((offset += width)), ...flags };
    markers.set(token, marker);
    const events = [
      ["enter", token, context],
      ["exit", token, context],
    ];
    named.set(name, { token, events, start: token.start, end: token.end });
    return events;
  });
  const events = observe(raw);
  context.events = events;
  return { events, named, context };
}
const data = (name) => ({ name });
function delimiter(kind, name, marker, width, flags) {
  return {
    name,
    marker,
    width,
    ...flags,
    type: kind === "strike" ? "strikethroughSequenceTemporary" : "attentionSequence",
  };
}
function scenario(kind, family, count = 1) {
  const specs = [data("prefix")];
  const marker = kind === "strike" ? "~" : "*";
  const width = kind === "strike" ? 2 : 1;
  for (let index = 0; index < count; index++) {
    const name = (value) => `${index}/${value}`;
    const run = (value, char, size, flags) => delimiter(kind, name(value), char, size, flags);
    if (family === "suffix-removal") {
      specs.push(
        run("older", kind === "strike" ? "~" : "_", kind === "strike" ? 2 : 1, {
          _open: true,
          _close: false,
        }),
        data(name("before")),
        run("open", marker, kind === "strike" ? 1 : 2, { _open: true, _close: false }),
        data(name("first")),
        run("inner", kind === "strike" ? "~" : "_", kind === "strike" ? 2 : 1, {
          _open: true,
          _close: false,
        }),
        data(name("second")),
        run("close", marker, kind === "strike" ? 1 : 2, { _open: false, _close: true }),
        data(name("third")),
        run("later", kind === "strike" ? "~" : "_", kind === "strike" ? 2 : 1, {
          _open: false,
          _close: true,
        }),
      );
    } else {
      specs.push(
        run(
          "open",
          marker,
          family === "partial-open" ? 5 : family === "partial-close" ? 2 : width,
          { _open: true, _close: false },
        ),
        data(name("middle")),
        run(
          "close",
          marker,
          family === "partial-close" ? 5 : family === "partial-open" ? 2 : width,
          { _open: false, _close: true },
        ),
      );
    }
    specs.push(data(name("separator")));
  }
  specs.push(data("suffix"));
  return specs;
}
function signature(events) {
  return JSON.parse(JSON.stringify(events.map(([phase, token]) => [phase, token])));
}
function preservedData(fixture) {
  for (const [name, original] of fixture.named) {
    if (original.token.type !== "data" || original.token._open || original.token._close) continue;
    assert(fixture.events.includes(original.events[0]), `Lost enter event: ${name}`);
    assert(fixture.events.includes(original.events[1]), `Lost exit event: ${name}`);
    assert.equal(original.token.start, original.start, `Changed data start identity: ${name}`);
    assert.equal(original.token.end, original.end, `Changed data end identity: ${name}`);
  }
}
function verifyResolvedScenario(fixture, kind, family, count) {
  const group = kind === "strike" ? "strikethrough" : family === "matched" ? "emphasis" : "strong";
  assert.equal(
    fixture.events.filter(([phase, token]) => phase === "enter" && token.type === group).length,
    kind === "strike" && family === "suffix-removal" ? count * 2 : count,
  );
  preservedData(fixture);
  if (family === "partial-open" || family === "partial-close") {
    const name = family === "partial-open" ? "open" : "close";
    for (let index = 0; index < count; index++) {
      const original = fixture.named.get(`${index}/${name}`);
      assert(
        fixture.events.some(([, token]) => token === original.token),
        "Partial token reference lost",
      );
      assert.equal(original.token.type, "data");
      assert.equal(original.token.end.offset - original.token.start.offset, 3);
      if (family === "partial-open") assert.equal(original.token.start, original.start);
      else assert.equal(original.token.end, original.end);
    }
  }
  if (family === "suffix-removal")
    for (let index = 0; index < count; index++) {
      const older = fixture.named.get(`${index}/older`);
      const later = fixture.named.get(`${index}/later`);
      const type = kind === "strike" ? "strikethrough" : "emphasis";
      assert(
        fixture.events.some(
          ([phase, token]) =>
            phase === "enter" &&
            token.type === type &&
            token.start.offset === older.start.offset &&
            token.end.offset === later.end.offset,
        ),
        "A consumed inner opener hid the surviving older opener",
      );
      const inner = fixture.named.get(`${index}/inner`);
      assert.equal(inner.token.type, "data");
      assert(fixture.events.includes(inner.events[0]));
      assert(fixture.events.includes(inner.events[1]));
      assert.equal(inner.token.start, inner.start);
      assert.equal(inner.token.end, inner.end);
      if (kind === "strike")
        for (const name of ["older", "open", "close", "later"]) {
          const original = fixture.named.get(`${index}/${name}`);
          assert(
            fixture.events.some(([, token]) => token === original.token),
            "Matched strike token reference lost",
          );
          assert.equal(original.token.start, original.start);
          assert.equal(original.token.end, original.end);
        }
    }
}
function selectedResolver(kind, module) {
  return kind === "attention"
    ? module.mdrefineResolveAttention
    : module.gfmStrikethrough().insideSpan.null[0].resolveAll;
}

/** Direct real repaired-module controls plus actual built-factory CJK controls. */
export async function verifyMatchingIdentity() {
  let cases = 0;
  for (const kind of ["attention", "strike", "cjk"])
    for (const family of kind === "strike"
      ? ["matched", "suffix-removal"]
      : ["matched", "partial-open", "partial-close", "suffix-removal"]) {
      const stockResolver =
        kind === "cjk"
          ? cjkFriendlyExtension().insideSpan.null[0].resolveAll
          : selectedResolver(kind, await correctedModule(kind, "stock"));
      const fixedResolver =
        kind === "cjk"
          ? (await generatedInlineParser()).cjkFriendlyExtension().insideSpan.null[0].resolveAll
          : selectedResolver(kind, await correctedModule(kind, "fixed"));
      const expected = eventFixture(scenario(kind, family), stockResolver);
      assert.equal(stockResolver(expected.events, expected.context), expected.events);
      verifyResolvedScenario(expected, kind, family, 1);
      for (const compatibility of [false, true]) {
        const actual = eventFixture(scenario(kind, family), fixedResolver, compatibility);
        assert.equal(fixedResolver(actual.events, actual.context), actual.events);
        verifyResolvedScenario(actual, kind, family, 1);
        assert.deepEqual(
          signature(actual.events),
          signature(expected.events),
          `${kind}/${family}/${compatibility}`,
        );
        cases++;
      }
    }
  return { cases };
}

/** Counts both input and repaired scratch-array traffic using the existing probe. */
export async function matchingWork(kind, family, variant, count) {
  const module = await correctedModule(kind, variant);
  const resolver = selectedResolver(kind, module);
  const fixture = eventFixture(
    scenario(kind, family, count),
    resolver,
    false,
    module.observeEvents,
  );
  module.resetWork();
  const returned = resolver(fixture.events, fixture.context);
  const work = Number(module.workStats.reads) + Number(module.workStats.writes);
  assert.equal(returned, fixture.events);
  verifyResolvedScenario(fixture, kind, family, count);
  return { work, signature: signature(fixture.events) };
}
