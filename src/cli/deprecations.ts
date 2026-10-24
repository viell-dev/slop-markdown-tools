import path from "node:path";
import type { ProcessOptions } from "../core/types.js";
import { directive } from "../core/directives.js";
import { resolveConfig } from "../config/resolve.js";
import { parse } from "../syntax/parse.js";
import { walk } from "../syntax/walk.js";

let warned = false;

/** CLI migration notice, separate from document findings and warning limits. */
export function warnLegacyNames(): void {
  if (warned) return;
  warned = true;
  process.stderr.write(
    "mdrefine: warning: mdtools names are deprecated and will be removed in 0.5.0; use mdrefine, mdrefine.config.*, and mdrefine-* comments.\n",
  );
}

export function warnLegacyConfig(file: string | undefined): void {
  if (file && /^mdtools\.config\.(?:jsonc?|[cm]?js)$/.test(path.basename(file))) warnLegacyNames();
}

/** Code examples and ordinary text mentioning the old prefix are not directives. */
export function warnLegacyDirectives(source: string, options: ProcessOptions): void {
  if (warned || !source.includes("mdtools-")) return;
  const config = resolveConfig(options);
  const document = parse(source, config.dialect, options.path, options.plugins, config.vitepress);
  walk(document.tree, "html", ({ value }) => {
    if (/^<!--\s*mdtools-/.test(value.trim()) && directive(value)) warnLegacyNames();
  });
}
