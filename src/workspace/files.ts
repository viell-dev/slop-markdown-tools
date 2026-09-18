import { lstat, readdir, readFile, realpath, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ignore from "ignore";
import { minimatch } from "minimatch";
import { exists } from "../config/load.js";

export interface FileSet {
  root: string;
  files: Record<string, string | null>;
  selected: string[];
  strictLineBreaks?: boolean;
}
export async function discover(
  rootPath: string,
  supplied: string[],
  excluded: string[],
): Promise<FileSet> {
  const root = await realpath(rootPath);
  const files: Record<string, string | null> = {};
  const selected: string[] = [];
  const requests: string[] = [];
  for (const input of supplied.length ? supplied : [root]) {
    const absolute = path.resolve(input);
    if ((await lstat(absolute)).isSymbolicLink())
      throw new Error(`Refusing symbolic-link input: ${input}`);
    const resolved = await realpath(absolute);
    const relative = path.relative(root, resolved).split(path.sep).join("/");
    if (relative.startsWith("../") || relative === ".." || path.isAbsolute(relative))
      throw new Error(`Input is outside the workspace: ${input}`);
    requests.push(relative);
  }
  interface IgnoreLayer {
    base: string;
    matcher: ReturnType<typeof ignore>;
  }
  async function walk(relative: string, inherited: IgnoreLayer[]) {
    const directory = path.join(root, relative);
    const layers = [...inherited];
    if (await exists(path.join(directory, ".gitignore")))
      layers.push({
        base: relative,
        matcher: ignore().add(await readFile(path.join(directory, ".gitignore"), "utf8")),
      });
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (
        [".git", ".obsidian", "node_modules", ".npm-cache", "dist", "coverage"].includes(
          entry.name,
        ) ||
        entry.isSymbolicLink()
      )
        continue;
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (
        layers.some((layer) =>
          layer.matcher.ignores(
            name.slice(layer.base ? layer.base.length + 1 : 0) + (entry.isDirectory() ? "/" : ""),
          ),
        )
      )
        continue;
      const full = path.join(root, name);
      if (entry.isDirectory()) {
        if (!(await exists(path.join(full, ".git")))) await walk(name, layers);
      } else if (entry.isFile()) {
        const markdown = /\.md$/i.test(name);
        files[name] = markdown ? await readFile(full, "utf8") : null;
        if (
          markdown &&
          requests.some(
            (request) => !request || name === request || name.startsWith(`${request}/`),
          ) &&
          !excluded.some((pattern) => minimatch(name, pattern, { dot: true }))
        )
          selected.push(name);
      }
    }
  }
  await walk("", []);
  let strictLineBreaks: boolean | undefined;
  const app = path.join(root, ".obsidian", "app.json");
  if (await exists(app)) {
    const settings: unknown = JSON.parse(await readFile(app, "utf8"));
    strictLineBreaks =
      typeof settings === "object" &&
      settings !== null &&
      "strictLineBreaks" in settings &&
      settings.strictLineBreaks === true;
  }
  return {
    root,
    files,
    selected: selected.sort(),
    ...(strictLineBreaks !== undefined ? { strictLineBreaks } : {}),
  };
}
export async function writeAtomic(file: string, before: string, after: string): Promise<void> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error(`Refusing non-regular file: ${file}`);
  if ((await readFile(file, "utf8")) !== before)
    throw new Error(`File changed during formatting: ${file}`);
  const temporary = path.join(path.dirname(file), `.mdtools-${randomUUID()}.tmp`);
  const handle = await open(temporary, "wx", info.mode);
  try {
    await handle.writeFile(after, "utf8");
    await handle.chmod(info.mode);
    await handle.sync();
    await handle.close();
    const current = await lstat(file);
    if (
      current.isSymbolicLink() ||
      current.ino !== info.ino ||
      (await readFile(file, "utf8")) !== before
    )
      throw new Error(`File changed before replacement: ${file}`);
    await rename(temporary, file);
  } finally {
    await handle.close();
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
