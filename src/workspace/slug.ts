/**
 * Heading anchors as Forgejo, and therefore Codeberg, generates them. Unicode letters,
 * numbers, and underscores are kept and lowercased; every other run of
 * characters becomes a single hyphen, with none leading or trailing. Repeated
 * anchors receive `-1`, `-2`, ... checked against every anchor already issued.
 * The renderer prefixes `user-content-`, which its page script hides from
 * authors, so links use the bare anchor.
 */
export function createForgejoSlugger(): { slug(text: string): string } {
  const seen = new Set<string>();
  return {
    slug(text) {
      let result = "";
      let pending = false;
      for (const character of text) {
        if (/[\p{L}\p{N}_]/u.test(character)) {
          if (pending && result) result += "-";
          pending = false;
          result += character.toLowerCase();
        } else pending = true;
      }
      if (!result) result = "heading";
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
