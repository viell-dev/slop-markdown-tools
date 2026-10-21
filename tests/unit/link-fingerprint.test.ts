import { expect, it } from "vitest";
import { createWorkspace, format, parse, semanticFingerprint } from "../../src/index.js";
import type { Dialect, Plugin, Workspace } from "../../src/index.js";

function proposed(before: string, after: string, workspace: Workspace, dialect: Dialect) {
  let start = 0;
  while (start < Math.min(before.length, after.length) && before[start] === after[start]) start++;
  let end = before.length;
  let to = after.length;
  while (end > start && to > start && before[end - 1] === after[to - 1]) {
    end--;
    to--;
  }
  const plugin: Plugin = {
    name: "proposal",
    rules: {
      change: {
        kind: "style",
        description: "Propose one link change",
        check: ({ document }) =>
          document.source === before
            ? [{ start, message: "Change", edit: { start, end, text: after.slice(start, to) } }]
            : [],
      },
    },
  };
  return format(before, {
    path: "note.md",
    workspace,
    plugins: [plugin],
    config: {
      extends: [],
      dialect,
      rules: { "proposal/change": "warn" },
    },
  });
}

it("keeps a resolved filename and fragment distinct when either contains # (#480)", () => {
  const before = "[go](a.md#b.md%23c)\n";
  const after = "[go](a.md%23b.md#c)\n";
  const workspace = createWorkspace({
    "note.md": before,
    "a.md": '<a id="b.md#c"></a>\n',
    "a.md#b.md": '<a id="c"></a>\n',
  });
  expect(workspace.resolve("note.md", "a.md#b.md%23c", "github")).toMatchObject({
    target: "a.md",
    fragmentExists: true,
  });
  expect(workspace.resolve("note.md", "a.md%23b.md#c", "github")).toMatchObject({
    target: "a.md#b.md",
    fragmentExists: true,
  });
  expect(semanticFingerprint(parse(before, "github"), workspace)).not.toBe(
    semanticFingerprint(parse(after, "github"), workspace),
  );
  const result = proposed(before, after, workspace, "github");
  expect(result.output).toBe(before);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ rule: "engine/unsafe-format" }),
  );
});

it("still canonicalizes ordinary aliases of the same file", () => {
  for (const dialect of ["github", "vitepress"] as const) {
    const before = "[go](a.md)\n";
    const after = "[go](./a.md)\n";
    const workspace = createWorkspace({ "note.md": before, "a.md": "# Title\n" }, { dialect });
    const result = proposed(before, after, workspace, dialect);
    expect(result.output).toBe(after);
    expect(result.diagnostics).toEqual([]);
  }
});

it("keeps URLs literal when a custom workspace supplies no filename identity (#480)", () => {
  const before = "[go](a.md)\n";
  const after = "[go](b.md)\n";
  const workspace: Workspace = { resolve: () => ({ status: "resolved", fragmentExists: true }) };
  const result = proposed(before, after, workspace, "github");
  expect(result.output).toBe(before);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ rule: "engine/unsafe-format" }),
  );
});

it("keeps a VitePress page's query string in its meaning", () => {
  const before = "[go](./a.md?view=first)\n";
  const after = "[go](./a.md?view=second)\n";
  const workspace = createWorkspace(
    { "note.md": before, "a.md": "# Title\n" },
    { dialect: "vitepress" },
  );
  expect(proposed(before, after, workspace, "vitepress").output).toBe(before);
});

it.each(['{target="_blank"}', "{download}"])(
  "keeps a bypassed VitePress href literal with %s",
  (attributes) => {
    const before = `[go](./a.md)${attributes}\n`;
    const after = `[go](./a.html)${attributes}\n`;
    const workspace = createWorkspace(
      { "note.md": before, "a.md": "# Title\n" },
      { dialect: "vitepress" },
    );
    expect(proposed(before, after, workspace, "vitepress").output).toBe(before);
  },
);

it("keeps a public asset URL distinct from a physical source-file alias", () => {
  const before = "[asset](/logo.svg)\n";
  const after = "[asset](./public/logo.svg)\n";
  const workspace = createWorkspace(
    { "note.md": before, "public/logo.svg": null },
    { dialect: "vitepress" },
  );
  const result = proposed(before, after, workspace, "vitepress");
  expect(result.output).toBe(before);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ rule: "engine/unsafe-format" }),
  );
});
