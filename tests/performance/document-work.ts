import { Session } from "node:inspector";
import type { Profiler } from "node:inspector";
import type { Document } from "../../src/index.js";

/**
 * Run `run` on a view of `document` and count what it reads: source characters,
 * including those a native search passes over, and properties of the tree. The
 * count does not depend on the machine, so comparing it across sizes separates
 * linear from quadratic work where timing cannot (#826).
 *
 * Any use of the source that is not counted here throws, so that a change to
 * the code under test cannot leave the count silently incomplete. Loops over
 * the code's own local data read neither: `blockCounter` sees those.
 */
export function countDocumentReads<Result>(
  document: Document,
  run: (observed: Document) => Result,
): { result: Result; reads: number } {
  const { source } = document;
  let reads = 0;
  const search = (needle: string, from = 0) => {
    const found = source.indexOf(needle, from);
    reads += (found < 0 ? source.length : found + needle.length) - from;
    return found;
  };
  const methods: Record<string | symbol, unknown> = {
    includes: (needle: string, from?: number) => search(needle, from) >= 0,
    indexOf: search,
    slice: (start?: number, end?: number) => {
      const text = source.slice(start, end);
      reads += text.length;
      return text;
    },
  };
  const observedSource = new Proxy(
    {},
    {
      get(_, key) {
        if (key === "length") return source.length;
        if (Object.hasOwn(methods, key)) return methods[key];
        // Not a regular expression: the counter below would count its own test.
        const index = typeof key === "string" ? Number(key) : NaN;
        if (!Number.isInteger(index)) throw new Error(`Uncounted source use: ${String(key)}`);
        reads++;
        return source[index];
      },
    },
  ) as string;
  // One view per object keeps identity, which searches of `children` compare.
  const views = new WeakMap<object, object>();
  const view = <Value>(value: Value): Value => {
    if (typeof value !== "object" || value === null) return value;
    const existing = views.get(value);
    if (existing) return existing as Value;
    const created = new Proxy(value, {
      get(target, key) {
        reads++;
        return view(Reflect.get(target, key) as unknown);
      },
    });
    views.set(value, created);
    return created;
  };
  // Called with an explicit receiver below, then restored in finally.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const exec = RegExp.prototype.exec;
  // `RegExp.prototype.test` goes through `exec` as well.
  RegExp.prototype.exec = function (this: RegExp, input: string) {
    const text = input === observedSource ? source : input;
    const from = this.global || this.sticky ? this.lastIndex : 0;
    const match = exec.call(this, text);
    reads += (match ? match.index + match[0].length : text.length) - from;
    return match;
  };
  try {
    const result = run({ ...document, source: observedSource, tree: view(document.tree) });
    return { result, reads };
  } finally {
    RegExp.prototype.exec = exec;
  }
}

/**
 * Count how many times V8 enters the blocks of scripts whose URL contains
 * `scripts`, which includes loops over local data. V8 only counts blocks in
 * functions compiled after this starts, so nothing may call the code under test
 * first: measuring throws if a function that ran lacks block counts.
 *
 * This shares V8's coverage counters: keep it out of the unit project, whose
 * coverage run reads them too.
 */
export function blockCounter(scripts: string) {
  const session = new Session();
  session.connect();
  session.post("Profiler.enable");
  session.post("Profiler.startPreciseCoverage", { callCount: true, detailed: true });
  /** Reading the counters resets them. A same-thread session replies synchronously. */
  const take = () => {
    const taken: Profiler.ScriptCoverage[] = [];
    session.post("Profiler.takePreciseCoverage", (error, coverage) => {
      if (!error) taken.push(...coverage.result);
    });
    return taken;
  };
  return {
    measure<Result>(run: () => Result): { result: Result; blocks: number } {
      take();
      const result = run();
      // A function's first range covers all of it, so a count there means it ran.
      const functions = take()
        .filter(({ url }) => url.includes(scripts))
        .flatMap(({ functions }) => functions)
        .filter(({ ranges }) => ranges[0]!.count > 0);
      if (!functions.length || !functions.every(({ isBlockCoverage }) => isBlockCoverage))
        throw new Error(`V8 did not report block counts for all that ran in ${scripts}`);
      const ranges = functions.flatMap(({ ranges }) => ranges);
      return { result, blocks: ranges.reduce((total, { count }) => total + count, 0) };
    },
    stop() {
      session.post("Profiler.stopPreciseCoverage");
      session.post("Profiler.disable");
      session.disconnect();
    },
  };
}
