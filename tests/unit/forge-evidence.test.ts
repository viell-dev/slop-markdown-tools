import { expect, it } from "vitest";
import { images, validateForgeEvidence } from "../../scripts/forge-evidence.mjs";
import { fileMarkup, forgeHtml } from "../../scripts/forge-html.mjs";

it("rejects missing hosts, wrong versions and absent actual file views", () => {
  const renderers = images.map((image) => ({
    ...image,
    observedVersion: image.version,
    compared: 5,
    fileViews: 6,
  }));
  expect(() => validateForgeEvidence({ renderers })).not.toThrow();
  expect(() => validateForgeEvidence({ renderers: renderers.slice(1) })).toThrow();
  for (const replacement of [
    { version: "wrong" },
    { image: "wrong" },
    { compared: 0 },
    { fileViews: 0 },
  ])
    expect(() =>
      validateForgeEvidence({ renderers: [{ ...renderers[0], ...replacement }, renderers[1]] }),
    ).toThrow();
});

it("isolates actual file markup while retaining anchors, links, code and formula source", () => {
  const body =
    '<h1 id="user-content-title">Title</h1><div><a href="#title">Go</a></div><code>$x$  y</code>';
  const page = `<header>UI</header><div class="file-view markup markdown">${body}</div><footer>UI</footer>`;
  expect(fileMarkup(page)).toBe(body);
  expect(() => fileMarkup("<div>No markup</div>")).toThrow();
  expect(() => fileMarkup('<div class="file-view markup">')).toThrow();
  for (const changed of [
    body.replace("#title", "#wrong"),
    body.replace("content-title", "content-wrong"),
    body.replace("$x$", "$z$"),
    body.replace("  y", " y"),
  ])
    expect(forgeHtml(changed)).not.toBe(forgeHtml(body));
});

it("normalizes generated task offsets only when bound to their actual source marker", () => {
  const source = "# H\n- [X] Task\n",
    output = "# H\n\n- [x] Task\n";
  const checkbox = (at: number, checked = true) =>
    `<input type="checkbox" disabled="" data-source-position="${at}"${checked ? ' checked=""' : ""}/>`;
  const before = checkbox(source.indexOf("[X]")),
    after = checkbox(output.indexOf("[x]"));
  expect(forgeHtml(before, source)).toBe(forgeHtml(after, output));
  expect(forgeHtml(before, source)).not.toBe(
    forgeHtml(checkbox(output.indexOf("[x]"), false), output),
  );
  expect(forgeHtml(before, "plain text")).toBe(before);
  expect(forgeHtml(before)).not.toBe(forgeHtml(after));
});
