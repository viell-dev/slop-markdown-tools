import path from "node:path";
import { realpath } from "node:fs/promises";
import { pathError, refusal } from "./access.js";

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
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
      const parent = path.dirname(file);
      if (parent === file) throw error;
      return path.join(await canonical(parent), path.basename(file));
    }
  }
  const relative = await Promise.all(
    exclusions.map(async (input) => {
      let actual: string;
      try {
        actual = await canonical(path.resolve(input));
      } catch (error) {
        // Without the real path nothing tells which file the exclusion stands for,
        // so the run must not carry on and process it.
        throw refusal(error) ? pathError("Excluded path", input, error) : error;
      }
      const name = path.relative(root, actual).split(path.sep).join("/");
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
