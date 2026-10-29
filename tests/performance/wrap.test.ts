import { expect, it } from "vitest";
import { builtInRules, createWorkspace, parse } from "../../src/index.js";
import { scaling } from "./scaling.js";
const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });

it("reflows many paragraphs in linear time regardless of the line ending", () => {
  // Exercise the rule directly: the edit application and diagnostic positioning
  // costs of format() are measured separately.
  const paragraph = "word ".repeat(30).trim();
  const rule = builtInRules["style/wrap"]!;
  const build = (count: number) =>
    Array.from({ length: count }, () => paragraph).join("\n\n") + "\n";
  const check = (source: string) =>
    rule.check({ document: parse(source, "commonmark"), options: { width: 40 } });
  const lf = build(8000);
  const lfFindings = check(lf);
  expect(lfFindings).toHaveLength(8000);
  expect(check(lf.replaceAll("\n", "\r\n")).map((item) => item.edit?.text)).toEqual(
    lfFindings.map((item) => item.edit?.text.replaceAll("\n", "\r\n")),
  );
  expect(lfFindings[0]?.edit?.text.split("\n").every((line) => line.length <= 40)).toBe(true);
  // Quadrupling the input should cost about four times as much. The former
  // per-paragraph CRLF scan cost about twelve times as much on LF sources;
  // the bound leaves room for noisy CI runners on both sides.
  const fastest = (source: string) => {
    const document = parse(source, "commonmark");
    let best = Infinity;
    for (let run = 0; run < 5; run++) {
      const started = performance.now();
      rule.check({ document, options: { width: 40 } });
      best = Math.min(best, performance.now() - started);
    }
    return best;
  };
  expect(fastest(build(32000)) / fastest(lf)).toBeLessThan(10);
  // The performance assertion is the ratio above, not a duration, so slow
  // runners get a longer limit than the 15-second default. Windows CI runners
  // have needed 6 to 15 seconds.
}, 60_000);

it("groups consecutive definition-like labels in linear time (#415)", () => {
  const rule = builtInRules["style/wrap"]!;
  const samples = [1000, 4000].map((count) => ({
    document: parse(`Intro ${"[a]:x ".repeat(count)}end.\n`, "obsidian"),
    expected: `Intro ${"[a]:x ".repeat(count).trimEnd()}\nend.`,
  }));
  const check = (index: number) =>
    rule.check({ document: samples[index]!.document, workspace, options: { width: 20 } });
  // Warm both sizes before measuring either: timing the large case cold and
  // the small case warm exaggerated their ratio on Node.js 22 (#424).
  for (let run = 0; run < 10; run++)
    for (const index of [0, 1]) expect(check(index)[0]?.edit?.text).toBe(samples[index]!.expected);
  const elapsed = (index: number, calls: number) => {
    let output: string | undefined;
    const started = performance.now();
    for (let call = 0; call < calls; call++) output = check(index)[0]?.edit?.text;
    const duration = performance.now() - started;
    expect(output).toBe(samples[index]!.expected);
    return duration;
  };
  // Calibrate once from the smaller case, then use the same bounded call
  // count for both. Batches target 25 ms rather than one short rule call.
  const calibration = Math.min(...Array.from({ length: 3 }, () => elapsed(0, 1)));
  const calls = Math.max(1, Math.min(256, Math.ceil(25 / calibration)));
  const fastest = [Infinity, Infinity];
  for (let run = 0; run < 4; run++)
    for (const index of run % 2 ? [1, 0] : [0, 1])
      fastest[index] = Math.min(fastest[index]!, elapsed(index, calls));
  // Four times the input must cost less than the roughly sixteenfold growth
  // of the former refill loop. Paired batches alternate their measurement order.
  expect(fastest[1]! / fastest[0]!).toBeLessThan(10);
}, 60_000);

it("finds VitePress protection reasons for many attributed paragraphs in linear time (#755)", () => {
  // Every short paragraph has its own protected attribute, and the last,
  // wide one is kept and reported; the control has no attributes and wraps
  // its last paragraph. A reason lookup that passed every earlier protected
  // part grew with the square of the paragraph count.
  const rule = builtInRules["style/wrap"]!;
  const wide =
    "Some words in a paragraph that goes on and on past the width of eighty columns here";
  const growth = (attribute: string) =>
    scaling(
      [2000, 16000],
      (count) =>
        parse(
          `Short paragraph${attribute}\n\n`.repeat(count) + `${wide}${attribute}\n`,
          "vitepress",
        ),
      (document) => rule.check({ document, options: { width: 80, reportUnreflowed: true } }),
      (findings) => {
        expect(findings).toHaveLength(1);
        if (attribute)
          expect(findings[0]).toMatchObject({
            message: "Paragraph not reflowed: VitePress attribute syntax (width 80 columns).",
          });
        else expect(findings[0]?.edit?.text).toContain("\n");
      },
      1,
    );
  const control = growth("");
  const dense = growth(" {.note}");
  // Eight times the paragraphs measured 8.4 to 8.7 times the time with the
  // index, as the control did, and 32 to 35 times with the former scan. Twice
  // the control's growth allows for a runner that is slow for both workloads.
  expect(dense).toBeLessThan(Math.max(20, 2 * control));
}, 120_000);
