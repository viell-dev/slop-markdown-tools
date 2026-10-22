import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createWorkspace, parse } from "../../src/index.js";
import { githubAnchors } from "../../src/workspace/anchors.js";

interface Fixture {
  name: string;
  source: string;
  generatedIds: string[];
}

// Generated IDs parsed from actual GitHub Markdown API HTML, markdown mode,
// repository context viell-dev/slop-markdown-tools, 2026-10-22. Controls include
// paths where the current implementation already agrees with GitHub.
const fixtures = JSON.parse(
  readFileSync(
    new URL("../fixtures/renderers/github-entity-boundaries.json", import.meta.url),
    "utf8",
  ),
) as Fixture[];

describe("character references at real HTML text-token boundaries", () => {
  it.each(fixtures)(
    "retains actual GitHub IDs and numbering for $name",
    ({ source, generatedIds }) => {
      const anchors = githubAnchors(parse(source, "github"));
      expect(anchors.complete).toBe(true);
      expect([...anchors.slugs]).toEqual(generatedIds);
      expect([...anchors.explicit]).toEqual([]);
      const workspace = createWorkspace({ "Note.md": source });
      for (const id of generatedIds)
        expect(workspace.resolve("From.md", `Note.md#${id}`, "github")).toMatchObject({
          status: "resolved",
          fragmentExists: true,
        });
    },
  );

  it("rejects the synthesized anchor while retaining later real collision IDs", () => {
    const fixture = fixtures.find(({ name }) => name === "flow-split-named-collisions")!;
    const workspace = createWorkspace({ "Note.md": fixture.source });
    expect(workspace.resolve("From.md", "Note.md#named-", "github").fragmentExists).toBe(false);
    expect(workspace.resolve("From.md", "Note.md#named-amp-1-1", "github").fragmentExists).toBe(
      true,
    );
  });
});
