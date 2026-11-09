import { convertConfig } from "../../src/index.js";

/** Convert complete competitor inputs without adding source-tool defaults. */
export function compatibilityOptions(input: Parameters<typeof convertConfig>[0]) {
  const r = convertConfig(input);
  return { config: r.config, compatibility: r.compatibility };
}
