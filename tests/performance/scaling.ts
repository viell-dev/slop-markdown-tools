/**
 * Compare fresh workloads at two sizes, with preparation and verification
 * outside the timed section. Balanced batches reduce cold-code and timer noise.
 */
export function scaling<Input, Output>(
  sizes: readonly [number, number],
  prepare: (size: number) => Input,
  run: (input: Input) => Output,
  verify: (output: Output, input: Input) => void,
  maxCalls = 8,
): number {
  return measureScaling(sizes, prepare, run, verify, maxCalls).ratio;
}

export interface ScalingMeasurement {
  sizes: readonly [number, number];
  warmup: number[];
  calibration: number[];
  calls: number;
  samples: [number[], number[]];
  ratio: number;
}

/** Retain scalar timing evidence for an assertion's failure message. */
export function measureScaling<Input, Output>(
  sizes: readonly [number, number],
  prepare: (size: number) => Input,
  run: (input: Input) => Output,
  verify: (output: Output, input: Input) => void,
  maxCalls = 8,
): ScalingMeasurement {
  const elapsed = (inputs: Input[]): number => {
    const outputs: Output[] = [];
    const started = performance.now();
    for (const input of inputs) outputs.push(run(input));
    const duration = performance.now() - started;
    outputs.forEach((output, index) => verify(output, inputs[index]!));
    return duration;
  };
  // Each operation warms on its actual size, never on the documents timed later.
  const warmup = sizes.map((size) => elapsed([prepare(size)]));
  const calibration = Array.from({ length: 3 }, () => elapsed([prepare(sizes[0])]));
  // One bounded call count for both sizes targets a measurable small batch.
  // Cap preparation too: fast scans can need expensive, freshly parsed trees.
  const calls = Math.max(1, Math.min(maxCalls, Math.ceil(25 / Math.min(...calibration))));
  const fastest = [Infinity, Infinity];
  const samples: [number[], number[]] = [[], []];
  for (let round = 0; round < 4; round++) {
    const inputs = sizes.map((size) => Array.from({ length: calls }, () => prepare(size)));
    for (const index of round % 2 ? [1, 0] : [0, 1]) {
      const duration = elapsed(inputs[index]!);
      samples[index]!.push(duration);
      fastest[index] = Math.min(fastest[index]!, duration);
    }
  }
  return {
    sizes: [...sizes],
    warmup,
    calibration,
    calls,
    samples,
    ratio: fastest[1]! / fastest[0]!,
  };
}
