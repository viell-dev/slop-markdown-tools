import {
  chmod,
  chown,
  link,
  mkdir,
  open,
  readFile,
  symlink,
  stat,
  writeFile,
} from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { discover } from "../../src/workspace/files.js";
import { replacementFailure, writeFormatted } from "../../src/workspace/writes.js";
import { enclosingVault, isVault } from "../../src/workspace/vault.js";
import { loadConfig } from "../../src/config/load.js";
import {
  canRestrict,
  canSymlink,
  denyWrite,
  fixture,
  linkDirectory,
  restrict,
  run,
  tree,
  windowsTool,
} from "../support/cli.js";
import { parseReport } from "../support/json.js";
describe("filesystem safeguards", () => {
  it("detects concurrent writes", async () => {
    const root = await fixture({ "note.md": "new content" });
    await expect(
      writeFormatted(path.join(root, "note.md"), "old content", "formatted"),
    ).rejects.toThrow("changed during");
    expect(await readFile(path.join(root, "note.md"), "utf8")).toBe("new content");
  });
  it("refuses to write anything but a regular file", async () => {
    const root = await fixture({});
    await mkdir(path.join(root, "folder.md"));
    await expect(writeFormatted(path.join(root, "folder.md"), "", "text")).rejects.toThrow(
      "Refusing non-regular file",
    );
  });
  it("compares the bytes on disk with those that were read, not their text", async () => {
    // Read from valid UTF-8 as U+FFFD, the text is the same as that of the file's
    // byte 0xE9 now, decoded with replacement; the bytes differ.
    const root = await fixture({ "note.md": Buffer.from([0x41, 0x20, 0xe9]) });
    const read = `A ${String.fromCharCode(0xfffd)}`;
    await expect(writeFormatted(path.join(root, "note.md"), read, "B")).rejects.toThrow(
      "changed during",
    );
    expect(await readFile(path.join(root, "note.md"))).toEqual(Buffer.from([0x41, 0x20, 0xe9]));
  });
  it("preserves file permissions", async () => {
    const root = await fixture({ "note.md": "old" });
    const file = path.join(root, "note.md");
    // Group write is a bit that a usual umask takes from a new file.
    if (process.platform !== "win32") await chmod(file, 0o660);
    const before = await stat(file);
    await writeFormatted(file, "old", "new");
    expect((await stat(file)).mode).toBe(before.mode);
  });
  it("writes into the file itself, so that its hard links keep sharing it", async () => {
    const root = await fixture({ "single.md": "A *b*.\n", "linked.md": "A *b*.\n" });
    // Windows allows hard links on NTFS without a privilege.
    await link(path.join(root, "linked.md"), path.join(root, "second-name.txt"));
    const single = await stat(path.join(root, "single.md"));
    const linked = await stat(path.join(root, "linked.md"));
    const applied = run(root, ["format", "--write"]);
    expect(applied.status, applied.stderr).toBe(0);
    expect(applied.stderr).toBe("2 file(s) processed; 2 written.\n");
    // Each document is still the file it was, and both names lead to the one file.
    expect((await stat(path.join(root, "single.md"))).ino).toBe(single.ino);
    const after = await stat(path.join(root, "second-name.txt"));
    expect([after.ino, after.nlink]).toEqual([linked.ino, 2]);
    expect(await tree(root)).toEqual({
      "linked.md": "A _b_.\n",
      "second-name.txt": "A _b_.\n",
      "single.md": "A _b_.\n",
    });
  });
  it("writes a file whose two names are both documents once", async () => {
    const root = await fixture({ "a.md": "A *b*.\n" });
    await link(path.join(root, "a.md"), path.join(root, "b.md"));
    const applied = run(root, ["format", "--write"]);
    expect(applied.status, applied.stderr).toBe(0);
    // The second name already holds the formatted text and is left as it is.
    expect(applied.stderr).toBe("2 file(s) processed; 2 written.\n");
    expect(await tree(root)).toEqual({ "a.md": "A _b_.\n", "b.md": "A _b_.\n" });
    expect((await stat(path.join(root, "b.md"))).nlink).toBe(2);
  });
  // A group of this process other than the one its new files get.
  const otherGroup =
    process.platform === "win32"
      ? undefined
      : process.getgroups?.().find((group) => group !== process.getegid?.());
  it.skipIf(otherGroup === undefined)("keeps a file's owner and group", async () => {
    const root = await fixture({ "note.md": "A *b*.\n" });
    const file = path.join(root, "note.md");
    await chown(file, process.getuid!(), otherGroup!);
    const before = await stat(file);
    const applied = run(root, ["format", "--write"]);
    expect(applied.status, applied.stderr).toBe(0);
    const after = await stat(file);
    expect([after.ino, after.gid, after.mode]).toEqual([before.ino, otherGroup, before.mode]);
    expect(await tree(root)).toEqual({ "note.md": "A _b_.\n" });
  });
  /** The prototype of Node.js's file handles, whose `write` only the write into the file calls. */
  async function handlePrototype(file: string): Promise<FileHandle> {
    const probe = await open(file, "r");
    await probe.close();
    return Object.getPrototypeOf(probe) as FileHandle;
  }
  const failure = Object.assign(new Error("EIO: i/o error, write"), {
    code: "EIO",
    syscall: "write",
  });
  it("writes the content back when writing into the file fails part way", async () => {
    const root = await fixture({ "note.md": "old text" });
    const file = path.join(root, "note.md");
    // The system fails once the first bytes of the new content have reached the file.
    const write = vi
      .spyOn(await handlePrototype(file), "write")
      .mockImplementationOnce(async () => {
        await writeFile(file, "ne");
        throw failure;
      });
    let error: unknown;
    try {
      error = await writeFormatted(file, "old text", "new text").catch((thrown: unknown) => thrown);
      expect(write).toHaveBeenCalledTimes(2);
    } finally {
      write.mockRestore();
    }
    expect(replacementFailure(error)).toBe(
      "The file could not be written (EIO: i/o error), and its content from before formatting was written back",
    );
    // Nothing is left beside the file.
    expect(await tree(root)).toEqual({ "note.md": "old text" });
  });
  it("says that the file may be incomplete when writing its content back fails too", async () => {
    const root = await fixture({ "note.md": "old text" });
    const file = path.join(root, "note.md");
    const write = vi.spyOn(await handlePrototype(file), "write").mockImplementation(async () => {
      await writeFile(file, "ne");
      throw failure;
    });
    let error: unknown;
    try {
      error = await writeFormatted(file, "old text", "new text").catch((thrown: unknown) => thrown);
      expect(write).toHaveBeenCalledTimes(2);
    } finally {
      write.mockRestore();
    }
    expect(replacementFailure(error)).toBe(
      "The file could not be written (EIO: i/o error), and writing its content from before formatting back failed too (EIO: i/o error); it may be incomplete",
    );
    expect(await tree(root)).toEqual({ "note.md": "ne" });
  });
  it("words a failure to write without the paths that the system names", () => {
    const error = (code: string, message: string, syscall?: string) =>
      Object.assign(new Error(message), { code, ...(syscall ? { syscall } : {}) });
    expect(
      replacementFailure(error("EROFS", "EROFS: read-only file system, open '/x/.tmp'", "open")),
    ).toBe("The file could not be written (EROFS: read-only file system) and is unchanged");
    // A refusal is worded the same on every platform.
    expect(replacementFailure(error("EBUSY", "EBUSY: busy, rename 'a' -> 'b'", "rename"))).toBe(
      "The file could not be written (EBUSY: resource busy or locked) and is unchanged",
    );
    expect(replacementFailure(error("EIO", "unusual"))).toBe(
      "The file could not be written (EIO) and is unchanged",
    );
    // Anything else is a fault of the tool and is not reported as a file's problem.
    expect(replacementFailure(new TypeError("fault"))).toBeUndefined();
  });
  const notes = { "a.md": "A *b*.\n", "held.md": "H *b*.\n", "z.md": "Z *b*.\n" };
  // A read-only file binds every user on Windows, and every user but root elsewhere.
  it.skipIf(process.platform !== "win32" && process.getuid?.() === 0)(
    "leaves a read-only file unchanged and writes the others",
    async () => {
      const root = await fixture(notes);
      await restrict(path.join(root, "held.md"), 0o444);
      const reason =
        process.platform === "win32"
          ? "EPERM: operation not permitted"
          : "EACCES: permission denied";
      const applied = run(root, ["format", "--write"]);
      expect(applied.status).toBe(2);
      expect(applied.stderr).toBe(
        `held.md:1:1: error engine/unwritable-file: The file may not be written (${reason}); the file is unchanged.\n` +
          "3 file(s) processed; 2 written; 1 could not be written.\n",
      );
      expect(await tree(root)).toEqual({ ...notes, "a.md": "A _b_.\n", "z.md": "Z _b_.\n" });
      const report = parseReport(run(root, ["format", "--write", "--json"]).stdout);
      expect(report.written).toEqual([]);
      expect(report.files[1]!.diagnostics[0]).toEqual({
        start: 0,
        message: `The file may not be written (${reason}); the file is unchanged.`,
        rule: "engine/unwritable-file",
        severity: "error",
        line: 1,
        column: 1,
      });
      // Only writing needs the file to be writable.
      expect(run(root, ["format", "--check"]).status).toBe(1);
      expect(run(root, ["lint"]).status).toBe(0);
      const rest = run(root, ["format", "--write", "--exclude", "held.md"]);
      expect(rest.status, rest.stderr).toBe(0);
      expect(await tree(root)).toEqual({ ...notes, "a.md": "A _b_.\n", "z.md": "Z _b_.\n" });
      // The tool never makes a file writable to write it.
      expect((await stat(path.join(root, "held.md"))).mode & 0o222).toBe(0);
    },
  );
  it.skipIf(!canRestrict)(
    "leaves a file in a folder that is not writable unchanged and writes the others",
    async () => {
      const root = await fixture({ "a.md": "A *b*.\n", "sub/s.md": "S *b*.\n" });
      await restrict(path.join(root, "sub"), 0o555);
      const applied = run(root, ["format", "--write"]);
      expect(applied.status).toBe(2);
      expect(applied.stderr).toBe(
        "sub/s.md:1:1: error engine/unwritable-file: The file's folder may not be written (EACCES: permission denied); the file is unchanged.\n" +
          "2 file(s) processed; 1 written; 1 could not be written.\n",
      );
      expect(await readFile(path.join(root, "a.md"), "utf8")).toBe("A _b_.\n");
      expect(await readFile(path.join(root, "sub/s.md"), "utf8")).toBe("S *b*.\n");
    },
  );
  // On Windows, a permission can deny writing a file that the read-only check
  // before writing lets through, and a program can lock a file it has open.
  it.skipIf(process.platform !== "win32")(
    "reports a file that cannot be written for that file and writes the others",
    async () => {
      const root = await fixture(notes);
      denyWrite(path.join(root, "held.md"));
      let applied = run(root, ["format", "--write", "--json"]);
      expect(applied.status).toBe(2);
      const report = parseReport(applied.stdout);
      expect(report.written).toEqual(["a.md", "z.md"]);
      expect(report.files[1]).toEqual({
        path: "held.md",
        changed: true,
        diagnostics: [
          {
            start: 0,
            message:
              "The file could not be written (EPERM: operation not permitted) and is unchanged.",
            rule: "engine/unwritable-file",
            severity: "error",
            line: 1,
            column: 1,
          },
        ],
      });
      expect(await tree(root)).toEqual({ ...notes, "a.md": "A _b_.\n", "z.md": "Z _b_.\n" });
      await writeFile(path.join(root, "a.md"), notes["a.md"]);
      applied = run(root, ["format", "--write"]);
      expect(applied.stderr).toBe(
        "held.md:1:1: error engine/unwritable-file: The file could not be written (EPERM: operation not permitted) and is unchanged.\n" +
          "3 file(s) processed; 1 written; 1 could not be written.\n",
      );
    },
  );
  it.skipIf(process.platform !== "win32")(
    "writes a file that another program has open and lets others write",
    async () => {
      const root = await fixture(notes);
      // Node.js opens a file for others to read, write, and delete it too.
      const handle = await open(path.join(root, "held.md"), "r");
      let applied: ReturnType<typeof run>;
      try {
        applied = run(root, ["format", "--write"]);
      } finally {
        await handle.close();
      }
      expect(applied.status, applied.stderr).toBe(0);
      expect(await tree(root)).toEqual({
        "a.md": "A _b_.\n",
        "held.md": "H _b_.\n",
        "z.md": "Z _b_.\n",
      });
    },
  );
  it.skipIf(process.platform !== "win32")(
    "keeps a Windows file's own permissions, attributes, streams, and creation time",
    async () => {
      const root = await fixture({ "note.md": "A *b*.\n" });
      const file = path.join(root, "note.md");
      const saved = path.join(await fixture({}), "acl.txt");
      /** The file's access control list, in Windows's security descriptor language. */
      const acl = async () => {
        windowsTool("icacls.exe", [file, "/save", saved]);
        return (await readFile(saved)).toString("utf16le");
      };
      // An entry of the file's own, which its folder does not pass on: everyone may read it.
      windowsTool("icacls.exe", [file, "/grant", "*S-1-1-0:(R)"]);
      windowsTool("attrib.exe", ["+H", file]);
      await writeFile(`${file}:extra`, "stream");
      const before = { acl: await acl(), born: (await stat(file)).birthtimeMs };
      expect(before.acl).toContain("(A;;FR;;;WD)");
      const applied = run(root, ["format", "--write"]);
      expect(applied.status, applied.stderr).toBe(0);
      expect(await readFile(file, "utf8")).toBe("A _b_.\n");
      expect({ acl: await acl(), born: (await stat(file)).birthtimeMs }).toEqual(before);
      // `attrib` prints the letters of the attributes, then the path.
      expect(windowsTool("attrib.exe", [file]).split(/\s+[A-Za-z]:\\/)[0]).toContain("H");
      expect(await readFile(`${file}:extra`, "utf8")).toBe("stream");
    },
  );
  // Windows lets a process create a symbolic link to a file only with a privilege.
  it.skipIf(!canSymlink)("refuses explicit symlinks and skips them during traversal", async () => {
    const root = await fixture({ "target.md": "*content*\n" });
    await symlink(path.join(root, "target.md"), path.join(root, "link.md"));
    await expect(discover(root, [path.join(root, "link.md")], [])).rejects.toThrow("symbolic-link");
    expect((await discover(root, [], [])).selected).toEqual(["target.md"]);
  });
  it("refuses a linked directory as input and skips it during traversal", async () => {
    const root = await fixture({ "folder/target.md": "*content*\n" });
    await linkDirectory(path.join(root, "folder"), path.join(root, "linked"));
    const named = run(root, ["lint", "linked"]);
    expect(named.status).toBe(2);
    expect(named.stderr).toBe("mdrefine: Refusing symbolic-link input: linked\n");
    expect((await discover(root, [], [])).selected).toEqual(["folder/target.md"]);
    // A path through the link names the file that the link leads to.
    const through = run(root, ["lint", "--json", path.join("linked", "target.md")]);
    expect(parseReport(through.stdout).files.map((file: { path: string }) => file.path)).toEqual([
      "folder/target.md",
    ]);
  });
  it("canonicalizes exclusion paths through a workspace alias", async () => {
    const root = await fixture({ "note.md": "*note*\n", "other.md": "Text.\n" });
    const aliasParent = await fixture({});
    const alias = path.join(aliasParent, "workspace");
    await linkDirectory(root, alias);
    const checked = run(root, [
      "lint",
      "--json",
      "--exclude",
      path.join(alias, "note.md"),
      "--exclude",
      path.join(alias, "not-created/note.md"),
    ]);
    expect(checked.status, checked.stderr).toBe(0);
    expect(parseReport(checked.stdout).files.map((file: { path: string }) => file.path)).toEqual([
      "other.md",
    ]);
  });
  it("finds the vault boundary when invoked from a subdirectory", async () => {
    const root = await fixture({ ".obsidian/app.json": "{}", "sub/note.md": "text" });
    expect((await loadConfig(path.join(root, "sub"))).root).toBe(root);
  });
  it("recognizes a vault by its .obsidian folder", async () => {
    const root = await fixture({
      ".obsidian/app.json": "{}",
      "nested/vault/.obsidian/app.json": "{}",
      "plain/note.md": "text",
      "file/.obsidian": "not a folder",
    });
    expect(await isVault(root)).toBe(true);
    expect(await isVault(path.join(root, "nested/vault"))).toBe(true);
    expect(await isVault(path.join(root, "nested"))).toBe(false);
    expect(await isVault(path.join(root, "plain"))).toBe(false);
    expect(await isVault(path.join(root, "file"))).toBe(false);
    // Neither a file nor a path that does not exist is a vault.
    expect(await isVault(path.join(root, "plain/note.md"))).toBe(false);
    expect(await isVault(path.join(root, "absent"))).toBe(false);
  });
  it("finds the nearest vault at or above a folder, up to a repository boundary", async () => {
    const root = await fixture({
      "outer/.obsidian/app.json": "{}",
      "outer/a/b/note.md": "text",
      "outer/inner/.obsidian/app.json": "{}",
      "outer/inner/c/note.md": "text",
      "outer/project/docs/page.md": "text",
      "outer/both/.obsidian/app.json": "{}",
      "plain/note.md": "text",
    });
    await mkdir(path.join(root, "outer/project/.git"));
    await mkdir(path.join(root, "outer/both/.git"));
    const outer = path.join(root, "outer");
    expect(await enclosingVault(outer)).toBe(outer);
    expect(await enclosingVault(path.join(outer, "a/b"))).toBe(outer);
    expect(await enclosingVault(path.join(outer, "a/b/not/created"))).toBe(outer);
    expect(await enclosingVault(path.join(outer, "inner/c"))).toBe(path.join(outer, "inner"));
    // A repository is examined itself and ends the search.
    expect(await enclosingVault(path.join(outer, "project/docs"))).toBeUndefined();
    expect(await enclosingVault(path.join(outer, "both"))).toBe(path.join(outer, "both"));
    // The fixture's own root is a repository, so nothing above it is examined.
    expect(await enclosingVault(path.join(root, "plain"))).toBeUndefined();
    expect(await enclosingVault(root)).toBeUndefined();
  });
});
