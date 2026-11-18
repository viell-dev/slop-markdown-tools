import { protectionSource } from "./protection-source.js";
import type { ProtectionSource } from "./protection-source.js";

/** Mirror isYAMLSeparator, including its extra byte step after a Unicode space. */
function yamlSeparator(line: string): boolean {
  let at = 0;
  const spaces = () => {
    while (at < line.length) {
      if (line[at] === " ") at++;
      else if (
        /^[\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/.test(line[at]!)
      ) {
        at++;
        // All Go non-ASCII spaces are BMP runes. Skipping one more UTF-8
        // byte either skips an ASCII character or lands on an invalid rune.
        if (at < line.length && line.charCodeAt(at) >= 0x80) return false;
        at++;
      } else break;
    }
    return true;
  };
  if (!spaces()) return false;
  const start = at;
  while (line[at] === "-") at++;
  return at - start >= 3 && spaces() && at >= line.length;
}

/** End of the first native metadata envelope, without interpreting its YAML. */
export function forgeFrontMatterEnd(
  source: string,
  positions: ProtectionSource = protectionSource(source),
): number | undefined {
  const { lineAround } = positions;
  // Both pinned file renderers accept CRLF. Keep physical source offsets.
  const firstEnd = lineAround(0)[1];
  if (!yamlSeparator(source.slice(0, firstEnd))) return undefined;
  for (let end = firstEnd; end < source.length;) {
    const start = end + (source.startsWith("\r\n", end) ? 2 : 1);
    end = lineAround(start)[1];
    if (yamlSeparator(source.slice(start, end))) return end;
  }
  return undefined;
}
