import type { Construct, Event, Point, Token, TokenizeContext } from "micromark-util-types";
import type {} from "micromark-extension-gfm-footnote";
import type {} from "micromark-extension-gfm-autolink-literal";
import type {} from "micromark-extension-gfm-strikethrough";

// These fragments run only inside the pinned upstream modules, after micromark
// has populated its normalized builtin tables. They are not extension APIs.
export type Context = TokenizeContext & {
  parser: TokenizeContext["parser"] & {
    constructs: {
      disable: { null: string[] };
      insideSpan: { null: Construct[] };
    };
  };
};
export type { Construct, Event, Point, Token };
export type Resolver = (events: Event[], context: Context) => Event[];
export interface Opener {
  index: number;
  token: Token;
  bucket: Opener[];
}
