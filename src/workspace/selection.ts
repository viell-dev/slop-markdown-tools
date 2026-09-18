import path from "node:path";
import { realpath } from "node:fs/promises";

/** Exclusions are literal paths relative to cwd, never glob patterns. */
export async function excludeSelection(
  root: string,
  selected: string[],
  exclusions: string[],
): Promise<string[]> {
  // Resolve filesystem aliases (including Windows short names) consistently
  // with discovery, while allowing exclusions for paths that do not exist yet.
  async function canonical(file: string): Promise<string> {
    try {
      return await realpath(file);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(file);
      if (parent === file) throw error;
      return path.join(await canonical(parent), path.basename(file));
    }
  }
  const relative = await Promise.all(
    exclusions.map(async (input) => {
      const name = path
        .relative(root, await canonical(path.resolve(input)))
        .split(path.sep)
        .join("/");
      if (name === ".." || name.startsWith("../") || path.isAbsolute(name))
        throw new Error(`Excluded path is outside the workspace: ${input}`);
      return name;
    }),
  );
  return selected.filter(
    (name) =>
      !relative.some(
        (excluded) => !excluded || name === excluded || name.startsWith(`${excluded}/`),
      ),
  );
}
