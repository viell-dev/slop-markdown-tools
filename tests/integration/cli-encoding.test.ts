import { isUtf8 } from "node:buffer";
import { readFile } from "node:fs/promises";
import path from "node:path";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { decodeText, invalidUtf8At } from "../../src/workspace/encoding.js";
import { fixture, run } from "./support.js";
import { parseReport } from "./json.js";
describe("documents that are not UTF-8 text", () => {
  const text = "# Title\r\n\r\n*text*\r\n";
  // UTF-16 with a byte order mark is what Windows PowerShell 5.1 writes for `>`.
  const littleEndian = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
  const files = {
    "be.md": Buffer.from(littleEndian).swap16(),
    "latin.md": Buffer.from("# Caf\xe9\n\n*text*\n", "latin1"),
    "le.md": littleEndian,
    "linking.md": "See [the heading](latin.md#cafe) of [the file](latin.md).\n",
    "note.md": "A *note*.\n",
    // Without a mark, UTF-16 text of ASCII characters is valid UTF-8.
    "unmarked.md": Buffer.from(text, "utf16le"),
  };
  const odd = ["be.md", "latin.md", "le.md", "unmarked.md"] as const;
  const reasons = {
    "be.md": "it starts with a UTF-16BE byte order mark",
    "latin.md": "byte 0xE9 on line 1 is not valid UTF-8",
    "le.md": "it starts with a UTF-16LE byte order mark",
    "unmarked.md": "line 1 contains a NUL byte, as UTF-16 text and binary files do",
  };
  const reported = (name: (typeof odd)[number], verb: string) =>
    `${name}:1:1: error engine/unreadable-file: The file is not UTF-8 text (${reasons[name]}) and was not ${verb}.\n`;
  const unchecked =
    "linking.md:1:5: error links/valid: Fragment could not be checked: latin.md#cafe (cannot read latin.md).\n";
  /** Whether every file that is not UTF-8 still holds the bytes it was written with. */
  const untouched = async (root: string) => {
    for (const name of odd)
      expect(await readFile(path.join(root, name)), name).toEqual(files[name]);
  };
  it("reports each such file, processes the others, and ends with status 2", async () => {
    const root = await fixture(files);
    const linted = run(root, ["lint"]);
    expect(linted.status).toBe(2);
    expect(linted.stderr).toBe(
      reported("be.md", "linted") +
        reported("latin.md", "linted") +
        reported("le.md", "linted") +
        unchecked +
        'note.md:1:3: warn style/emphasis: Use "_" for emphasis.\n' +
        'note.md:1:8: warn style/emphasis: Use "_" for emphasis.\n' +
        reported("unmarked.md", "linted") +
        "2 file(s) linted; 5 error(s), 2 warning(s); 4 could not be read.\n",
    );
    const report = parseReport(run(root, ["format", "--check", "--json"]).stdout);
    expect(report.files[1]).toEqual({
      path: "latin.md",
      changed: false,
      diagnostics: [
        {
          start: 0,
          message: `The file is not UTF-8 text (${reasons["latin.md"]}) and was not formatted.`,
          rule: "engine/unreadable-file",
          severity: "error",
          line: 1,
          column: 1,
        },
      ],
    });
    // Linking to the file without a fragment needs only to know that it exists.
    const named = run(root, ["lint", "linking.md"]);
    expect(named.status).toBe(1);
    expect(named.stderr).toBe(unchecked + "1 file(s) linted; 1 error(s), 0 warning(s).\n");
  });
  it("never writes into one, and writes the others", async () => {
    const root = await fixture(files);
    const applied = run(root, ["format", "--write"]);
    expect(applied.status).toBe(2);
    expect(applied.stderr).toContain("2 file(s) processed; 1 written; 4 could not be read.\n");
    await untouched(root);
    expect(await readFile(path.join(root, "note.md"), "utf8")).toBe("A _note_.\n");
    // Without them, nothing else stands in the way.
    const rest = run(root, ["format", "--write", ...odd.flatMap((name) => ["--exclude", name])]);
    expect(rest.status).toBe(1);
    expect(rest.stderr).toBe(unchecked + "2 file(s) processed; 0 written.\n");
    await untouched(root);
  });
  it("stops with status 2 for stdin that is not UTF-8 text, and reads it with a mark", async () => {
    const root = await fixture({});
    for (const [name, reason] of Object.entries(reasons))
      for (const command of ["lint", "format"]) {
        const piped = run(root, [command, "-"], files[name as (typeof odd)[number]]);
        expect(piped.status, name).toBe(2);
        expect(piped.stdout).toBe("");
        expect(piped.stderr).toBe(`mdrefine: stdin is not UTF-8 text (${reason})\n`);
      }
    const mark = Buffer.from([0xef, 0xbb, 0xbf]);
    const marked = run(root, ["format", "-"], Buffer.concat([mark, Buffer.from("A *b*.\n")]));
    expect(marked.status, marked.stderr).toBe(0);
    expect(marked.stdout).toBe(`${String.fromCharCode(0xfeff)}A _b_.\n`);
  });
  it("names the first byte that is not valid UTF-8, and its line", () => {
    const at = (...bytes: number[]) => invalidUtf8At(Uint8Array.from(bytes));
    // Overlong forms, surrogates, code points above U+10FFFF, and cut sequences.
    expect([at(0xc0, 0x80), at(0xe0, 0x80, 0x80), at(0xed, 0xa0, 0x80)]).toEqual([0, 0, 0]);
    expect([at(0xf4, 0x90, 0x80, 0x80), at(0x41, 0xe2, 0x82), at(0x80)]).toEqual([0, 1, 0]);
    expect([at(0xe2, 0x82, 0xac), at(0xf0, 0x9f, 0x98, 0x80, 0xc3, 0xa9)]).toEqual([-1, -1]);
    // Unicode's rules are those of Node.js's own check, for valid text with random
    // bytes inside it as well as for random bytes alone.
    const valid = fc.string({ unit: "binary", maxLength: 6 }).map((value) => Buffer.from(value));
    const mixed = fc
      .tuple(valid, fc.uint8Array({ maxLength: 6 }), valid)
      .map((parts) => Buffer.concat(parts));
    fc.assert(
      fc.property(mixed, (input) => {
        const invalid = invalidUtf8At(input);
        expect(invalid < 0).toBe(isUtf8(input));
        if (invalid >= 0) expect(isUtf8(input.subarray(0, invalid))).toBe(true);
      }),
      { numRuns: 2000 },
    );
    const reason = (bytes: Buffer) => {
      try {
        decodeText(bytes, "x.md");
      } catch (error) {
        return (error as Error).message;
      }
      return undefined;
    };
    expect(reason(Buffer.from("a\r\nb\rc\nd\xff", "latin1"))).toBe(
      "Not UTF-8 text: x.md (byte 0xFF on line 4 is not valid UTF-8)",
    );
    expect(reason(Buffer.from([0xff, 0xfe, 0, 0, 0x41, 0, 0, 0]))).toBe(
      "Not UTF-8 text: x.md (it starts with a UTF-32LE byte order mark)",
    );
    expect(reason(Buffer.from("a\n\nb\0", "latin1"))).toContain("line 3 contains a NUL byte");
    expect(reason(Buffer.from("Caf\xc3\xa9", "latin1"))).toBeUndefined();
  });
});
