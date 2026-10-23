import { isAlias, isMap, isPair, isScalar, isSeq, parseDocument } from "yaml";
import type { Document } from "../core/types.js";
import type { Root } from "mdast";
import { frontMatterReading, githubFileReading, plainReading } from "../syntax/parse.js";
import { githubAnchors } from "./anchors.js";
import type { GithubAnchors } from "./anchors.js";

const ordinaryTags = new Set([
  "tag:yaml.org,2002:map",
  "tag:yaml.org,2002:seq",
  "tag:yaml.org,2002:str",
  "tag:yaml.org,2002:null",
  "tag:yaml.org,2002:bool",
  "tag:yaml.org,2002:int",
  "tag:yaml.org,2002:float",
]);

/** True for GitHub's metadata/error body, false for ordinary Markdown, otherwise unsettled. */
function metadataBody(value: string): boolean | undefined {
  // Actual Contents rendering accepts mappings with ordinary nested values,
  // duplicate/complex keys and tags. YAML/alias errors also strip the envelope
  // before rendering the body. Parse only the AST: never resolve aliases,
  // execute custom tags or turn metadata into JavaScript objects.
  const yaml = parseDocument(value, {
    version: "1.1",
    uniqueKeys: false,
    logLevel: "silent",
    prettyErrors: false,
  });
  // yaml reports its own stack/resource failures as parse errors. They do not
  // prove that GitHub rejects valid deeply nested input the same way.
  if (yaml.errors.some(({ code }) => code === "RESOURCE_EXHAUSTION")) return undefined;
  if (yaml.errors.length || isMap(yaml.contents)) return true;
  let unsupported = yaml.warnings.length > 0;
  const pending: unknown[] = [yaml.contents];
  while (pending.length) {
    const node = pending.pop();
    if (isAlias(node)) return true;
    if (isPair(node)) pending.push(node.key, node.value);
    else if (isMap(node) || isSeq(node) || isScalar(node)) {
      if (node.tag && !ordinaryTags.has(node.tag)) unsupported = true;
      if (isMap(node) || isSeq(node)) {
        for (const item of node.items) pending.push(item);
      } else if (
        node.value !== null &&
        !["string", "number", "boolean"].includes(typeof node.value)
      )
        // Dates, binary and other scalar classes may be rejected by GitHub's
        // YAML implementation. Its exact class policy is not established.
        unsupported = true;
    }
  }
  return unsupported ? undefined : false;
}

/**
 * Repository-file anchors after GitHub's YAML preprocessing. The supplied-tree
 * collector and formatter safety readings retain their existing meanings.
 * `originalSource` preserves facts such as a leading BOM that parse normalizes.
 * Nothing returned here retains source, Markdown/YAML ASTs or selector closures.
 */
export function githubFileAnchors(
  document: Document,
  markdown = githubAnchors(document),
  originalSource = document.source,
): GithubAnchors {
  const collect = (selected: Root) => {
    const reading = githubFileReading(selected);
    return reading === document.tree ? markdown : githubAnchors({ ...document, tree: reading });
  };
  const candidate =
    document.tree.children[0]?.type === "yaml" ? document.tree : frontMatterReading(document.tree);
  const matter = candidate?.children[0];
  if (!candidate || matter?.type !== "yaml") return collect(document.tree);
  const withMatter = () => collect(candidate);
  const withoutMatter = () => collect(plainReading(candidate));
  // The immutable matrix confirms byte-zero --- fences, horizontal trailing
  // whitespace and LF/CRLF; a BOM or leading blank leaves ordinary Markdown.
  if (!/^---[ \t]*(?:\r\n|\n|\r)/.test(originalSource)) return withoutMatter();
  const selected = /\r(?!\n)/.test(originalSource.slice(0, matter.position!.end.offset))
    ? undefined
    : metadataBody(matter.value);
  if (selected === true) return withMatter();
  if (selected === false) return withoutMatter();

  // Unsettled YAML classes/boundaries number each reading independently. An ID
  // can be generated in one and explicit in the other, so intersect membership.
  const metadata = withMatter();
  const plain = withoutMatter();
  const metadataIds = new Set([...metadata.slugs, ...metadata.explicit]);
  const plainIds = new Set([...plain.slugs, ...plain.explicit]);
  const known = new Set<string>();
  for (const id of metadataIds) if (plainIds.has(id)) known.add(id);
  return {
    complete:
      metadata.complete &&
      plain.complete &&
      known.size === metadataIds.size &&
      known.size === plainIds.size,
    slugs: known,
    explicit: new Set(),
  };
}
