/**
 * Number repeated anchors `-1`, `-2`, ... checked against every anchor already
 * issued, and give a heading without anchor characters the anchor `heading`.
 * The renderers prefix `user-content-`, which their page scripts hide from
 * authors, so links use the bare anchor.
 */
function createSlugger(clean: (text: string) => string): { slug(text: string): string } {
  const seen = new Set<string>();
  return {
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
export function createForgejoSlugger(): { slug(text: string): string } {
  return createSlugger((text) => {
    let result = "";
    let pending = false;
    for (const character of text) {
      if (/[\p{L}\p{N}_]/u.test(character)) {
        if (pending && result) result += "-";
        pending = false;
        result += character.toLowerCase();
      } else pending = true;
    }
    return result;
  });
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
export function createGiteaSlugger(): { slug(text: string): string } {
  return createSlugger((text) => {
    let result = "";
    for (const character of text.replace(/^\p{White_Space}+|\p{White_Space}+$/gu, "")) {
      if (/[\p{L}\p{N}_-]/u.test(character)) result += character.toLowerCase();
      else if (/\p{White_Space}/u.test(character)) result += "-";
    }
    return result;
  });
}
