import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { exists, refusal, refusalText } from "./access.js";
import type { RefusalCode } from "./access.js";

/** An Obsidian vault that holds documents of a workspace. */
export interface Vault {
  /**
   * The part of the workspace that the vault holds: its folder relative to the
   * workspace root, or "" when the vault is the root or a folder above it.
   */
  path: string;
  /**
   * The `strictLineBreaks` setting in the vault's `.obsidian/app.json`;
   * undefined when the file is absent or could not be used.
   */
  strictLineBreaks?: boolean;
  /**
   * For a vault whose folder lies above the workspace root: the root's path
   * from that folder, with forward slashes. The workspace is then only a part
   * of the vault.
   */
  rootInVault?: string;
}
/** Why a vault's settings file could not be used: the system's refusal, or its content. */
export interface SettingsProblem {
  code: RefusalCode | "INVALID";
  reason: string;
}

/** Whether `directory` has a `.obsidian` folder; a refusal is thrown as it is. */
async function hasSettingsFolder(directory: string): Promise<boolean> {
  try {
    return (await stat(path.join(directory, ".obsidian"))).isDirectory();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Nothing has that name, or `directory` is not a folder itself.
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
}
/**
 * A refusal stays an error, in words: taking a folder for no vault could format
 * its notes as another dialect. Any other error is passed on.
 */
function unknownVault(question: string, error: unknown): unknown {
  const code = refusal(error);
  return code
    ? new Error(`Cannot tell whether ${question} (${refusalText(code)})`, { cause: error })
    : error;
}
/**
 * Whether `directory` is the root of an Obsidian vault: Obsidian keeps a vault's
 * settings in a `.obsidian` folder there. A file of that name is not one.
 */
export async function isVault(directory: string): Promise<boolean> {
  try {
    return await hasSettingsFolder(directory);
  } catch (error) {
    throw unknownVault(`${directory} is an Obsidian vault`, error);
  }
}
/**
 * The folder of the vault that holds `location`, a file or a folder that need
 * not exist: the nearest folder at or above it that contains `.obsidian`. The
 * search ends at a repository boundary, a folder that contains `.git`, which is
 * the last one examined. Discovery leaves the documents of a repository inside
 * a workspace alone, so a repository checked out inside a vault is not read as
 * that vault's notes.
 */
export async function enclosingVault(location: string): Promise<string | undefined> {
  let current = path.resolve(location);
  try {
    for (;;) {
      if (await hasSettingsFolder(current)) return current;
      const parent = path.dirname(current);
      if (parent === current || (await exists(path.join(current, ".git")))) return undefined;
      current = parent;
    }
  } catch (error) {
    throw unknownVault(`${location} is inside an Obsidian vault`, error);
  }
}
/**
 * The `strictLineBreaks` setting of the vault in `directory`: undefined without
 * a settings file, and a problem instead when the file is there but cannot be
 * used. Unverified settings are safe, because Obsidian reflow needs them
 * verified; any other read error is a fault.
 */
export async function lineBreakSetting(
  directory: string,
): Promise<{ value?: boolean; problem?: SettingsProblem }> {
  const app = path.join(directory, ".obsidian", "app.json");
  let text: string;
  try {
    if (!(await exists(app))) return {};
    text = await readFile(app, "utf8");
  } catch (error) {
    const code = refusal(error);
    if (code) return { problem: { code, reason: refusalText(code) } };
    if ((error as NodeJS.ErrnoException).code === "EISDIR")
      return { problem: { code: "INVALID", reason: "not a file" } };
    throw error;
  }
  let settings: unknown;
  try {
    settings = JSON.parse(text);
  } catch {
    return { problem: { code: "INVALID", reason: "not valid JSON" } };
  }
  return {
    value:
      typeof settings === "object" &&
      settings !== null &&
      "strictLineBreaks" in settings &&
      settings.strictLineBreaks === true,
  };
}
/** The vault that holds the workspace file `name`: the deepest one around it. */
export function vaultOf(vaults: Vault[], name: string): Vault | undefined {
  let found: Vault | undefined;
  for (const vault of vaults)
    if (
      (!vault.path || name.startsWith(`${vault.path}/`)) &&
      (!found || vault.path.length > found.path.length)
    )
      found = vault;
  return found;
}
