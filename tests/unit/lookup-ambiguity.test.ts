import { expect, it, vi } from "vitest";
import { createWorkspace } from "../../src/index.js";

it("reports a host's ambiguous match without reading a candidate's text (#459)", () => {
  const read = vi.fn(() => {
    throw new Error("No unique target to read");
  });
  const workspace = createWorkspace(
    {},
    {
      lookup: () => ({ type: "file", path: "dist/One.md", source: read, ambiguous: true }),
    },
  );
  expect(workspace.resolve("Note.md", "dist/one.md#Heading", "obsidian", true).status).toBe(
    "ambiguous",
  );
  expect(read).not.toHaveBeenCalled();
});

it.each([undefined, false])(
  "keeps existing unique lookup results with ambiguous=%j",
  (ambiguous) => {
    const workspace = createWorkspace(
      {},
      {
        lookup: () => ({
          type: "file",
          path: "dist/One.md",
          source: "# Heading\n",
          ...(ambiguous === undefined ? {} : { ambiguous }),
        }),
      },
    );
    expect(workspace.resolve("Note.md", "dist/one.md#Heading", "obsidian", true)).toMatchObject({
      status: "resolved",
      target: "dist/One.md",
      fragmentExists: true,
    });
  },
);
