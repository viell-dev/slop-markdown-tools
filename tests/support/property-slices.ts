/** fast-check parameters for one slice of a fixed-seed run. */
export interface SliceParameters {
  numRuns: number;
  seed: number;
  path: string;
}

/**
 * Split a fixed-seed fast-check run of `total` inputs into consecutive slices
 * of `size`, so that each slice is its own test under the ordinary deadline
 * while together they check the same inputs in the same order (#902).
 *
 * A `path` without a colon starts the seeded stream at that run, and
 * fast-check adds the offset to the path it reports, so a failing slice
 * prints a path that replays against the whole run. Its "failed after N
 * tests" count starts at the slice. `property-slices.test.ts` checks that the
 * slices replay the unsliced stream.
 */
export function seededSlices(
  seed: number,
  total: number,
  size: number,
): [offset: number, parameters: SliceParameters][] {
  if (!Number.isInteger(size) || size < 1 || total % size !== 0) {
    throw new Error(`Cannot split ${total} runs into slices of ${size}`);
  }
  return Array.from({ length: total / size }, (_, index) => {
    const offset = index * size;
    return [offset, { numRuns: size, seed, path: String(offset) }];
  });
}
