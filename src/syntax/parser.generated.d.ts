// Internal factories bundled by scripts/build-parser.mjs. Keep this shipped shim
// usable without the build-only extension packages; public plugin types remain upstream.
import type { Extension } from "micromark-util-types";

export { fromMarkdown } from "mdast-util-from-markdown";

interface StrikethroughOptions {
  singleTilde?: boolean | null | undefined;
}

export declare function gfm(options?: StrikethroughOptions | null | undefined): Extension;
export declare function gfmAutolinkLiteral(): Extension;
export declare function gfmFootnote(): Extension;
export declare function gfmStrikethrough(
  options?: StrikethroughOptions | null | undefined,
): Extension;
export declare function cjkFriendlyExtension(): Extension;
