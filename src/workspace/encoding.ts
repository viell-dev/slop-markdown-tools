import { isUtf8 } from "node:buffer";

/**
 * The code of the error for bytes that are not UTF-8 text. Node.js's
 * `TextDecoder`, created with `fatal: true`, throws an error with the same code
 * for bytes that are not valid in its encoding.
 */
const notUtf8Code = "ERR_ENCODING_INVALID_ENCODED_DATA";

/** Bytes that are not UTF-8 text, with what is wrong in words that do not name their source. */
export class NotUtf8Error extends Error {
  readonly code = notUtf8Code;
  constructor(
    readonly reason: string,
    message: string,
  ) {
    super(message);
  }
}
/** Whether an error says that bytes are not UTF-8 text, as `decodeText` and a fatal `TextDecoder` do. */
export function isNotUtf8(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && "code" in error && error.code === notUtf8Code
  );
}
/**
 * The byte order marks of other encodings. UTF-32LE's starts with UTF-16LE's,
 * so it is looked for first.
 */
const marks = [
  ["UTF-32LE", [0xff, 0xfe, 0x00, 0x00]],
  ["UTF-32BE", [0x00, 0x00, 0xfe, 0xff]],
  ["UTF-16LE", [0xff, 0xfe]],
  ["UTF-16BE", [0xfe, 0xff]],
] as const;
/**
 * The offset of the first byte that does not start a valid UTF-8 sequence, or
 * -1 when every one does. A sequence is valid as Unicode's table of
 * well-formed byte sequences defines it: no overlong forms, no surrogates, and
 * nothing above U+10FFFF.
 */
export function invalidUtf8At(bytes: Uint8Array): number {
  for (let at = 0; at < bytes.length;) {
    const lead = bytes[at]!;
    if (lead < 0x80) {
      at++;
      continue;
    }
    // The length of the sequence, and the range of its second byte.
    let size: number;
    let low = 0x80;
    let high = 0xbf;
    if (lead >= 0xc2 && lead <= 0xdf) size = 2;
    else if (lead >= 0xe0 && lead <= 0xef) {
      size = 3;
      if (lead === 0xe0) low = 0xa0;
      if (lead === 0xed) high = 0x9f;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      size = 4;
      if (lead === 0xf0) low = 0x90;
      if (lead === 0xf4) high = 0x8f;
    } else return at;
    for (let next = 1; next < size; next++) {
      const byte = bytes[at + next];
      if (
        byte === undefined ||
        byte < (next === 1 ? low : 0x80) ||
        byte > (next === 1 ? high : 0xbf)
      )
        return at;
    }
    at += size;
  }
  return -1;
}
/** The line that a byte offset lies on, counting LF, CR, and CRLF as line ends. */
function lineAt(bytes: Uint8Array, offset: number): number {
  let line = 1;
  for (let at = 0; at < offset; at++)
    if (bytes[at] === 0x0a || (bytes[at] === 0x0d && bytes[at + 1] !== 0x0a)) line++;
  return line;
}
/** What keeps `bytes` from being read as UTF-8 text, or undefined when nothing does. */
function problem(bytes: Buffer): string | undefined {
  for (const [name, mark] of marks)
    if (mark.every((byte, index) => bytes[index] === byte))
      return `it starts with a ${name} byte order mark`;
  const invalid = isUtf8(bytes) ? -1 : invalidUtf8At(bytes);
  const nul = bytes.indexOf(0);
  if (nul >= 0 && (invalid < 0 || nul < invalid))
    return `line ${lineAt(bytes, nul)} contains a NUL byte, as UTF-16 text and binary files do`;
  if (invalid < 0) return undefined;
  const byte = bytes[invalid]!.toString(16).toUpperCase().padStart(2, "0");
  return `byte 0x${byte} on line ${lineAt(bytes, invalid)} is not valid UTF-8`;
}
/**
 * The text of `bytes`, which must be UTF-8, with or without a byte order mark.
 * A mark stays at the start of the text, where formatting keeps it. Text with a
 * NUL byte is refused too: Markdown has no use for one, and UTF-16 text without
 * a byte order mark, whose ASCII characters each have one, could otherwise pass
 * for UTF-8 and be damaged by an edit. Anything else throws a `NotUtf8Error`
 * whose message names `subject`, instead of replacing what cannot be decoded.
 */
export function decodeText(bytes: Buffer, subject: string): string {
  const reason = problem(bytes);
  if (reason) throw new NotUtf8Error(reason, `Not UTF-8 text: ${subject} (${reason})`);
  return bytes.toString("utf8");
}
