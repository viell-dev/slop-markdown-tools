/** Lowercase one code point with Go's simple case mapping, which keeps `İ` one `i`. */
function lower(character: string): string {
  return character === "\u0130" ? "i" : character.toLowerCase();
}

export interface Slugger {
  /** The anchor generated from heading text. */
  slug(text: string): string;
  /**
   * The anchor of a heading whose attributes set `id`, which replaces the
   * generated one. It is used as written, never numbered, and does not count as
   * issued: Forgejo 16 and Gitea before 1.26 record it without the
   * `user-content-` prefix that generated anchors are compared with, and Gitea
   * 1.26 and later number nothing. Only an id written with that prefix, which
   * the renderers do not add twice, takes the anchor after it.
   */
  custom(id: string): string;
}

/**
 * Number repeated anchors `-1`, `-2`, ... checked against every anchor already
 * issued, and give a heading without anchor characters the anchor `heading`.
 * The renderers prefix `user-content-`, which their page scripts hide from
 * authors, so links use the bare anchor.
 */
function createSlugger(clean: (text: string) => string): Slugger {
  const seen = new Set<string>();
  return {
    custom(id) {
      const anchor = id.replace(/^user-content-/, "");
      if (anchor !== id) seen.add(anchor);
      return anchor;
    },
    slug(text) {
      const result = clean(text) || "heading";
      if (!seen.has(result)) {
        seen.add(result);
        return result;
      }
      for (let i = 1; ; i++) {
        const candidate = `${result}-${i}`;
        if (!seen.has(candidate)) {
          seen.add(candidate);
          return candidate;
        }
      }
    },
  };
}

/**
 * Heading anchors as Forgejo, and therefore Codeberg, generates them. Unicode letters,
 * numbers, and underscores are kept and lowercased; every other run of
 * characters becomes a single hyphen, with none leading or trailing.
 */
export function createForgejoSlugger(): Slugger {
  return createSlugger(forgejoAnchor);
}
/** One Forgejo anchor without numbering. */
export function forgejoAnchor(text: string): string {
  let result = "";
  let pending = false;
  for (const character of text) {
    if (/[\p{L}\p{N}_]/u.test(character)) {
      if (pending && result) result += "-";
      pending = false;
      result += lower(character);
    } else pending = true;
  }
  return result;
}

/**
 * Heading anchors as Gitea 1.21 and later generates them. Surrounding
 * whitespace is trimmed; Unicode letters, numbers, `_`, and `-` are kept and
 * lowercased; each remaining whitespace character becomes a hyphen; everything
 * else, including combining marks, is dropped. Gitea 1.26 and later give
 * repeated headings the same anchor and punctuation-only headings none, so the
 * numbered and `heading` anchors that earlier versions generate are accepted
 * as well.
 */
export function createGiteaSlugger(): Slugger {
  return createSlugger(giteaAnchor);
}
/** One Gitea anchor without numbering, as Gitea 1.26 and later generate them. */
export function giteaAnchor(text: string): string {
  let result = "";
  for (const character of text.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "")) {
    if (/[\p{L}\p{N}_-]/u.test(character)) result += lower(character);
    else if (/\p{White_Space}/u.test(character)) result += "-";
  }
  return result;
}
