import { expect, it } from "vitest";
import { verifyEventIdentity } from "../parser-event-identity.mjs";

it("preserves surviving events, token references and endpoint identities", async () => {
  expect(await verifyEventIdentity()).toEqual({ cases: 10 });
});
