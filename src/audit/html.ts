import type { Dialect } from "../core/types.js";
import { isVueHtmlTag, scan } from "../rules/html-elements.js";

/** A conservative coverage check of raw HTML, independent of renderer-visible tag mapping. */
export function htmlNavigationLimit(html: string, dialect: Dialect): string | undefined {
  if (dialect === "vitepress" && /<!--\s*@include\s*:/.test(html))
    return "Navigation inside transclusions is not modeled.";
  let reason: string | undefined;
  let tags = 0;
  let from = 0;
  const body: string[] = [];
  // GitHub's tag filter escapes raw-text wrappers while leaving their bodies as HTML.
  const result = scan(
    html,
    undefined,
    (tag) => {
      body.push(html.slice(from, tag.from));
      from = tag.to;
      if (tag.close) return;
      tags++;
      const name = tag.name.toLowerCase();
      const attributes = tag.attributes;
      if (!attributes) {
        reason ??= "HTML attributes could add navigation that is not fully modeled.";
        return;
      }
      if (dialect === "vitepress" && (tag.name !== name || !isVueHtmlTag(name)))
        reason ??= "Navigation in custom or foreign VitePress elements is not modeled.";
      if ([...attributes.keys()].some((key) => /^(?:[:@#]|v-|on[a-z])/.test(key)))
        reason ??= "Dynamic HTML attributes could add navigation that is not modeled.";
      if (attributes.has("srcdoc"))
        reason ??= "Navigation inside embedded HTML content is not modeled.";
      const targets = [
        attributes.get("href"),
        attributes.get("xlink:href"),
        attributes.get("action"),
        attributes.get("formaction"),
      ];
      if (name === "iframe" || name === "embed" || name === "frame")
        targets.push(attributes.get("src"));
      if (name === "object") targets.push(attributes.get("data"));
      for (const target of targets) {
        // Only HTML's ASCII whitespace is removed; broader Unicode trimming could hide a local path.
        const value = target?.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, "");
        if (value && !value.startsWith("#") && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value))
          reason ??= `Local HTML navigation is not modeled: ${value}.`;
      }
    },
    dialect !== "github",
  );
  if (!result.certain || result.inside !== undefined)
    reason ??= "Raw HTML has an uncertain boundary; its navigation is not fully modeled.";
  body.push(html.slice(from));
  // Attribute values and comments are opaque, even when they contain Markdown-looking text.
  const text = body.join("").replace(/<!--[\s\S]*?-->/g, "");
  if (tags && text.includes("["))
    reason ??= "Markdown-looking navigation inside raw HTML is not fully modeled.";
  return reason;
}
