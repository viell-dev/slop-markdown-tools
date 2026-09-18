import { describe, expect, it } from "vitest";
import { format, lint } from "../src/index.js";
import type { Config } from "../src/index.js";

function check(
  source: string,
  rule: string,
  options: Record<string, unknown> = {},
  path = "Title.md",
  dialect: Config["dialect"] = "obsidian",
) {
  const config: Config = { extends: [], dialect, rules: { [rule]: ["error", options] } };
  const diagnostics = lint(source, { config, path });
  const result = format(source, { config, path });
  expect(result.output).toBe(source);
  expect(result.changed).toBe(false);
  expect(result.diagnostics).toEqual(diagnostics);
  expect(diagnostics.every((item) => item.edit === undefined)).toBe(true);
  expect(lint(source, { config: { extends: [] } })).toEqual([]);
  return diagnostics;
}
describe("document structure rules", () => {
  it.each([
    "# Title\n",
    "Title\n=====\n",
    "---\ntitle: Title\n---\n\n# Title\n",
    "+++\ntitle = 'Title'\n+++\n\n# Title\n",
  ])("accepts an initial level-1 heading after optional front matter", (source) => {
    expect(check(source, "structure/initial-heading")).toEqual([]);
  });
  it.each([
    "",
    "---\ntitle: Title\n---\n",
    "Prose.\n\n# Title\n",
    "## Subtitle\n",
    "> # Title\n",
    "<!-- comment -->\n\n# Title\n",
  ])("reports a missing initial level-1 heading", (source) => {
    expect(check(source, "structure/initial-heading")).toHaveLength(1);
  });
  it("compares rendered title text with the filename and supports Windows paths", () => {
    expect(
      check("# *Title*\n", "structure/title-matches-filename", {}, "folder\\Title.md"),
    ).toEqual([]);
    expect(check("# 日記\n", "structure/title-matches-filename", {}, "日記.md")).toEqual([]);
    expect(check("# Other\n", "structure/title-matches-filename")[0]?.message).toContain("Title");
    expect(check("## Title\n", "structure/title-matches-filename")[0]?.message).toContain(
      "Missing",
    );
    expect(check("# title\n", "structure/title-matches-filename")).toHaveLength(1);
  });
  it("supports filename/stem ignore patterns and normal overrides", () => {
    expect(
      check("# Project\n", "structure/title-matches-filename", { ignore: ["README"] }, "README.md"),
    ).toEqual([]);
    expect(
      check(
        "# Project\n",
        "structure/title-matches-filename",
        { ignore: ["README.*"] },
        "README.md",
      ),
    ).toEqual([]);
    expect(
      lint("Body\n", {
        path: "generated/a.md",
        config: {
          extends: [],
          rules: { "structure/initial-heading": "error" },
          overrides: [{ files: ["generated/**"], rules: { "structure/initial-heading": "off" } }],
        },
      }),
    ).toEqual([]);
  });
  const metadata = { pattern: "^\\*\\*Updated:\\*\\* \\d{4}-\\d{2}-\\d{2}$" };
  const date = "**Updated:** 2026-09-18";
  it("accepts one standalone metadata paragraph with optional blank lines and callout", () => {
    expect(check(`# Title\n${date}\n`, "structure/metadata-line", metadata)).toEqual([]);
    expect(check(`# Title\n\n${date}\n\nText.\n`, "structure/metadata-line", metadata)).toEqual([]);
    expect(
      check(`# Title\n\n> [!info]- Details\n> Body.\n\n${date}\n`, "structure/metadata-line", {
        ...metadata,
        afterCallout: true,
      }),
    ).toEqual([]);
    expect(check(`# Title\r\n\r\n${date}\r\n`, "structure/metadata-line", metadata)).toEqual([]);
  });
  it("reports missing, misplaced, duplicate, and non-standalone metadata", () => {
    expect(check("# Title\n\nText.\n", "structure/metadata-line", metadata)[0]?.message).toContain(
      "Missing",
    );
    expect(
      check(`# Title\n\nText.\n\n${date}\n`, "structure/metadata-line", metadata)[0]?.message,
    ).toContain("standalone");
    expect(
      check(`# Title\n\n${date}\n\n${date}\n`, "structure/metadata-line", metadata).some((item) =>
        item.message.includes("Duplicate"),
      ),
    ).toBe(true);
    expect(
      check(`# Title\n\n${date}\nProse continuation.\n`, "structure/metadata-line", metadata)[0]
        ?.message,
    ).toContain("standalone");
    expect(check(`${date}\n`, "structure/metadata-line", metadata)[0]?.message).toContain(
      "standalone",
    );
    expect(
      check(`# Title\n\n> [!info]\n> Body.\n\n${date}\n`, "structure/metadata-line", metadata)[0]
        ?.message,
    ).toContain("standalone");
    expect(
      check(`# Title\n\n> Ordinary quotation.\n\n${date}\n`, "structure/metadata-line", {
        ...metadata,
        afterCallout: true,
      })[0]?.message,
    ).toContain("standalone");
  });
  it("does not mistake code, front matter, or comments for metadata", () => {
    const source = `---\nfield: '${date}'\n---\n\n# Title\n\n\`\`\`md\n${date}\n\`\`\`\n\n<!-- ${date} -->\n`;
    expect(check(source, "structure/metadata-line", metadata)[0]?.message).toContain("Missing");
    for (const example of [
      `Text \`code\n${date}\ncode\` after.`,
      `Text %% comment\n${date}\ncomment %% after.`,
    ]) {
      expect(
        check(`# Title\n\n${example}\n`, "structure/metadata-line", metadata)[0]?.message,
      ).toContain("Missing");
    }
    expect(
      check(
        `# Title\n\n${date}\n\n\`\`\`md\n${date}\n\`\`\`\n`,
        "structure/metadata-line",
        metadata,
      ),
    ).toEqual([]);
  });
  it("validates required options and regular expressions", () => {
    expect(() => check("# Title\n", "structure/metadata-line")).toThrow("Invalid options");
    expect(() => check("# Title\n", "structure/metadata-line", { pattern: "[" })).toThrow(
      "valid regular expression",
    );
  });
});
describe("accidental block marker heuristic", () => {
  it.each(["- one item", "1. one item", "# Heading", "> Quotation"])(
    "reports adjacent %s without proposing edits",
    (next) => {
      const findings = check(`Some prose ending in a word\n${next}\n`, "style/accidental-marker");
      expect(findings).toHaveLength(1);
      expect(findings[0]?.line).toBe(2);
    },
  );
  it.each([
    "Some prose:\n- one item\n",
    "Some **prose:**\n- one item\n",
    "Some prose\n\n- one item\n",
    "Some prose\n  - one item\n",
    "> Some prose\n> - one item\n",
    "- Some prose\n  - nested item\n",
    "Some prose\n2. lazy continuation\n",
    "```md\nSome prose\n- one item\n```\n",
  ])(
    "leaves intentional spacing, introductions, containers, and literal examples alone",
    (source) => {
      expect(check(source, "style/accidental-marker")).toEqual([]);
    },
  );
});
