import { expect } from "vitest";

/** Vitest's matcher is opaque data for assertions, not an `any` value to inspect. */
export const stringContaining = (value: string): unknown => expect.stringContaining(value);
