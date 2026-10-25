import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, open, readFile, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { systemErrorText } from "./access.js";

/**
 * A file that `writeFormatted` would not write, or did not write completely,
 * with the reason in words that do not name it.
 */
export class ReplacementRefused extends Error {
  constructor(
    readonly reason: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
/**
 * Why `file` cannot be written, or undefined when nothing stands in the way
 * that can be seen before writing: the file may not be written, or its folder
 * does not let the trial file be created beside it. A read-only file is refused
 * on every platform: the flag marks a file that is not to be edited.
 */
export async function replacementProblem(file: string): Promise<string | undefined> {
  for (const [target, subject] of [
    [file, "The file"],
    [path.dirname(file), "The file's folder"],
  ] as const) {
    try {
      await access(target, constants.W_OK);
    } catch (error) {
      const text = systemErrorText(error);
      if (!text) throw error;
      return `${subject} may not be written (${text})`;
    }
  }
  return undefined;
}
/**
 * What went wrong when `writeFormatted` failed for a file, in words that do
 * not name it, or undefined for an error that is a fault of the tool.
 */
export function replacementFailure(error: unknown): string | undefined {
  if (error instanceof ReplacementRefused) return error.reason;
  const text = systemErrorText(error);
  return text ? `The file could not be written (${text}) and is unchanged` : undefined;
}
/** The refusal for a file whose bytes are no longer those that were read. */
function changedOnDisk(file: string, when: string): ReplacementRefused {
  return new ReplacementRefused(
    "The file changed on disk during formatting and was not written",
    `File changed ${when}: ${file}`,
  );
}
/**
 * Show that `size` more bytes fit on the disk of `folder`, by writing a file
 * of that size there and removing it. It holds random bytes, not the
 * document's text: a file left behind by a crash then reveals nothing, and a
 * disk that compresses what it stores cannot make the trial smaller than the
 * write. Common file systems set aside the room when the bytes are written, so
 * the trial is not flushed to the disk; a file system that runs out of room only
 * then makes the write itself fail, and the file's content is written back.
 */
async function trialWrite(folder: string, size: number): Promise<void> {
  const trial = path.join(folder, `.mdrefine-${randomUUID()}.tmp`);
  const handle = await open(trial, "wx", 0o600);
  try {
    await handle.writeFile(randomBytes(size));
  } finally {
    await handle.close();
    await unlink(trial).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
/** Make the open file hold exactly `content`. */
async function overwrite(handle: FileHandle, content: Buffer): Promise<void> {
  for (let at = 0; at < content.length;)
    at += (await handle.write(content, at, content.length - at, at)).bytesWritten;
  await handle.truncate(content.length);
  await handle.sync();
}
/**
 * Write the formatted text `after` into `file`, whose text was read as
 * `before`, if the file still holds exactly the bytes that were read. The file
 * itself is written, not replaced by a new one, so that it keeps its
 * permissions, attributes, owner, creation time, and hard links, which Node.js
 * cannot all carry over to a new file. A trial write beside the file first shows that
 * the new content fits on the disk. The file is then checked through the open
 * file, just before writing. If writing fails part way, the bytes that were read
 * are written back, and the reason says whether that worked. A file that already
 * holds `after`, as the second name of a hard link written earlier in the batch
 * does, is left as it is.
 */
export async function writeFormatted(file: string, before: string, after: string): Promise<void> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink())
    throw new ReplacementRefused(
      "The file is not a regular file and was not written",
      `Refusing non-regular file: ${file}`,
    );
  // The text was decoded from valid UTF-8, so encoding it again gives the bytes
  // that were read; comparing the text instead would miss a change to bytes that
  // decode to the same text.
  const expected = Buffer.from(before, "utf8");
  const content = Buffer.from(after, "utf8");
  const found = await readFile(file);
  if (found.equals(content)) return;
  if (!found.equals(expected)) throw changedOnDisk(file, "during formatting");
  await trialWrite(path.dirname(file), content.length);
  const handle = await open(file, "r+");
  try {
    // The path may lead to another file by now, such as through a link put in its place.
    const current = await handle.stat();
    if (current.ino !== info.ino || !(await handle.readFile()).equals(expected))
      throw changedOnDisk(file, "before writing");
    try {
      await overwrite(handle, content);
    } catch (error) {
      const text = systemErrorText(error);
      if (!text) throw error;
      let undone: string | undefined;
      try {
        await overwrite(handle, expected);
      } catch (again) {
        undone = systemErrorText(again);
        if (!undone) throw again;
      }
      throw new ReplacementRefused(
        undone === undefined
          ? `The file could not be written (${text}), and its content from before formatting was written back`
          : `The file could not be written (${text}), and writing its content from before formatting back failed too (${undone}); it may be incomplete`,
        `File written in part: ${file}`,
        { cause: error },
      );
    }
  } finally {
    await handle.close();
  }
}
