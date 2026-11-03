import { expect, it } from "vitest";
import type { Event } from "micromark-util-types";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { parse } from "../../src/index.js";
import type { Plugin } from "../../src/index.js";
import { loadParserModule } from "../support/parser/parser-module-probes.mjs";
import {
  blankLineDriver,
  builtinContainers,
  listPreparer,
  nestedList,
  originalContainers,
  rawContainerEvents,
} from "../support/parser/parser-containers.mjs";

it("reuses only proven whitespace suffixes across cursor restores and lines (#859)", async () => {
  const fixed = await blankLineDriver("fixed");
  const stock = await blankLineDriver("stock");
  for (const ending of [null, -3, -4, -5, 120]) {
    // -2/-1 represent a tab and its virtual columns, sharing source offsets.
    const codes = [120, 32, -2, -1, -1, 32, ending, 32, 120];
    const candidate = fixed(codes);
    const reference = stock(codes);
    for (const at of [2, 3, 5, 6, 2, 1, 0, 7, 8, 4, 2])
      expect(candidate.check(at), JSON.stringify({ ending, at })).toBe(reference.check(at));
  }
  const first = fixed([32, 32, 120]);
  expect(first.check(0)).toBe(false);
  expect(first.check(1)).toBe(false);
  expect(first.work()).toEqual({ consumed: 2, checks: 1 });
  // Same cursor coordinates in another tokenizer must not inherit a proof.
  const second = fixed([32, 32, -4]);
  expect(second.check(1)).toBe(true);
  expect(second.work()).toEqual({ consumed: 1, checks: 1 });
});

it("bounds whitespace grammar work and keeps explicit original-marker precedence (#859)", async () => {
  const fixed = await blankLineDriver("fixed");
  const stock = await blankLineDriver("stock");
  const work = (count: number, variant: typeof fixed, disabled?: string[]) => {
    const driver = variant([...Array<number>(count).fill(32), 120], disabled);
    for (let at = 0; at < count; at++) expect(driver.check(at)).toBe(false);
    return driver.work().consumed;
  };
  expect(work(80, fixed) / work(20, fixed)).toBe(4);
  expect(work(80, stock) / work(20, stock)).toBeGreaterThan(15);
  expect(work(80, fixed, [])).toBe(work(80, stock));
  expect(work(80, fixed, originalContainers.disable.null)).toBe(work(80, stock));
});

it("preserves raw tuple identities and declines unexpected container stacks before mutation (#859)", async () => {
  const prepare = (await listPreparer()) as (events: Event[]) => Event[] | undefined;
  const input = "- a\n\n  - b\n\n- c\n\n  [^n]: - d\n    - e\n";
  const events = rawContainerEvents(input);
  const tuples = events.slice();
  const prepared = prepare(events);
  expect(prepared).toBeDefined();
  expect(events).toEqual(tuples);
  expect(prepared?.filter((event) => tuples.includes(event))).toEqual(tuples);
  for (const tuple of tuples) expect(prepared?.filter((event) => event === tuple)).toHaveLength(1);
  expect(prepared?.filter((event) => event[1].type === "listItem")).not.toHaveLength(0);
  for (const extension of [{}, originalContainers]) {
    const fallback = rawContainerEvents(input, extension);
    const before = fallback.map(([kind, token]) => [kind, structuredClone(token)]);
    expect(prepare(fallback)).toBeUndefined();
    expect(fallback.map(([kind, token]) => [kind, structuredClone(token)])).toEqual(before);
  }
  for (const change of ["missing", "identity"] as const) {
    const malformed = rawContainerEvents("- a\n  - b\n");
    const closing = malformed.findLastIndex(
      ([kind, token]) => kind === "exit" && token.type === "listUnordered",
    );
    if (change === "missing") malformed.splice(closing, 1);
    else {
      const event = malformed[closing]!;
      malformed[closing] = ["exit", { ...event[1] }, event[2]];
    }
    const before = malformed.map(([kind, token]) => [kind, structuredClone(token)]);
    expect(prepare(malformed)).toBeUndefined();
    expect(malformed.map(([kind, token]) => [kind, structuredClone(token)])).toEqual(before);
  }
});

it.each(["commonmark", "github"] as const)(
  "keeps %s list ranges, looseness and plugin compiler observations (#859)",
  async (dialect) => {
    // Use the guarded production module: upstream's development tokenizer
    // asserts when a compiler-synthesized item's range crosses chunk contexts.
    const stock = (await loadParserModule("footnote", "stock")).fromMarkdown as typeof fromMarkdown;
    const fixed = (await loadParserModule("footnote", "fixed")).fromMarkdown as typeof fromMarkdown;
    const sources = [
      "- a\n  - b\n\n- c\n",
      "- a\n\n  - b\n\n- c\n",
      "> - a\n>\n>   - b\n",
      "- a\n\t- b\n\t\t- c\n",
      "[^n]: - a\n  - b\n\n    - c\n",
      nestedList(20),
    ];
    const read = (input: string, mode: "stock" | "product" | "fixed") => {
      const trace: unknown[] = [];
      const tokens = new Map<object, number>();
      const points = new Map<object, number>();
      const id = (map: Map<object, number>, value: object) => {
        if (!map.has(value)) map.set(value, map.size);
        return map.get(value);
      };
      type Listener = NonNullable<NonNullable<Plugin["syntax"]>["mdast"]["beforeEnter"]>;
      const observe = (kind: string): Listener =>
        function (token) {
          trace.push([
            kind,
            id(tokens, token),
            Object.keys(token),
            Object.fromEntries(
              Object.entries(token).filter(
                ([, value]) =>
                  value === null ||
                  ["string", "number", "boolean", "undefined"].includes(typeof value),
              ),
            ),
            id(points, token.start),
            { ...token.start },
            id(points, token.end),
            { ...token.end },
            this.stack.map((node) => node.type),
            this.sliceSerialize(token),
          ]);
        };
      const mdast = { beforeEnter: observe("enter"), afterExit: observe("exit") };
      const tree =
        mode === "product"
          ? parse(input, dialect, "list.md", [
              { name: "observer", syntax: { micromark: builtinContainers, mdast } },
            ]).tree
          : (mode === "fixed" ? fixed : stock)(input, {
              extensions: [
                ...(dialect === "github" ? [gfm()] : []),
                ...(mode === "fixed" ? [builtinContainers] : []),
              ],
              mdastExtensions: [...(dialect === "github" ? [gfmFromMarkdown()] : []), mdast],
            });
      return { tree, trace };
    };
    for (const source of sources)
      for (const eol of ["\n", "\r\n", "\r"]) {
        const input = source.replaceAll("\n", eol);
        const reference = read(input, "stock");
        expect(read(input, "product"), input).toEqual(reference);
        expect(read(input, "fixed"), input).toEqual(reference);
      }
  },
);
