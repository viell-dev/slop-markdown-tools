// The Obsidian check: formats documents with the repository's build and compares what Obsidian
// shows before and after, in Live Preview and in Reading view. It runs in the container that
// scripts/obsidian-check.mjs starts, with the repository mounted read-only at /repo, and writes
// its report to /out. SEED repeats a run's generated documents, COUNT sets how many there are.
import console from "node:console";
import { writeFileSync } from "node:fs";
import process from "node:process";
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";

const { createWorkspace, format } = await import("/repo/dist/index.js");
const { documentSeed, generateDocument, normalizeHtml } =
  await import("/repo/scripts/rendering.mjs");
const { fixtures } = await import("/repo/scripts/obsidian/fixtures.mjs");

const seed = Number(process.env.SEED || Math.floor(Math.random() * 2 ** 32)) >>> 0;
const count = Number(process.env.COUNT || 100);
/** Widths to format at: the preset's, and a narrow one that reflows nearly every paragraph. */
const widths = [80, 30];

/** What Obsidian shows a note as, read in its page: Reading view's HTML and Live Preview's lines. */
async function shown(path, text) {
  return browser.executeObsidian(
    async ({ app, obsidian }, path, text) => {
      const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      // Reading view, through the renderer that it uses.
      const component = new obsidian.Component();
      component.load();
      const container = document.createElement("div");
      await obsidian.MarkdownRenderer.render(app, text, container, path, component);
      await settle(50);
      const reading = container.innerHTML;
      component.unload();

      let file = app.vault.getFileByPath(path);
      for (let wait = 0; !file && wait < 50; wait++) {
        await settle(100);
        file = app.vault.getFileByPath(path);
      }
      const leaf = app.workspace.getLeaf(false);
      await leaf.openFile(file, { active: true, state: { mode: "source", source: false } });
      const cm = leaf.view.editor.cm;
      cm.contentDOM.blur();
      await settle(150);

      const ui =
        "img.cm-widgetBuffer, .cm-fold-indicator, .code-block-flair, svg, .embed-actions, .table-col-drag-handle, .table-row-drag-handle, .table-row-btn, .table-col-btn, .callout-icon, .collapse-indicator";
      const style =
        /^(?:cm-(?:strong|em|strikethrough|inline-code|highlight|link|url|hashtag|hmd-internal-link|link-alias|comment|hmd-barelink|header-\d|formatting[\w-]*|hmd-footnote|footref)|list-bullet|is-unresolved|task-list-item-checkbox)$/;
      /** The text of a line's content, as runs of [classes of what shows it, text]. */
      const runs = (node, classes, out) => {
        for (const child of node.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            if (child.data) out.push([classes, child.data]);
            continue;
          }
          if (child.nodeType !== Node.ELEMENT_NODE || child.matches(ui)) continue;
          if (child.matches(".math"))
            out.push([`${classes} math`, child.querySelector("[data-latex]")?.dataset.latex ?? ""]);
          else if (child.matches(".internal-embed, .image-embed"))
            out.push([`${classes} embed`, child.getAttribute("src") ?? child.textContent]);
          else if (child.matches("input[type=checkbox]"))
            out.push([`${classes} checkbox`, child.checked ? "x" : " "]);
          else {
            const own = [...child.classList].filter((name) => style.test(name)).sort();
            runs(child, own.length ? `${classes} ${own.join(" ")}`.trim() : classes, out);
          }
        }
        return out;
      };
      /** A block widget's HTML without the controls that Live Preview adds. */
      const widget = (element) => {
        const copy = element.cloneNode(true);
        for (const control of copy.querySelectorAll(ui)) control.remove();
        return copy.innerHTML;
      };
      // Live Preview renders the lines in view; scroll through the note and collect them all.
      const lines = new Map();
      const scroller = cm.scrollDOM;
      for (let top = 0; ; top += Math.max(200, scroller.clientHeight - 200)) {
        scroller.scrollTop = top;
        await settle(60);
        for (const element of cm.contentDOM.children) {
          // A gap stands for lines out of view, which a later scroll position shows.
          if (element.classList.contains("cm-gap")) continue;
          let at;
          try {
            at = cm.posAtDOM(element, 0);
          } catch {
            continue;
          }
          if (lines.has(at)) continue;
          if (element.classList.contains("cm-line"))
            lines.set(at, {
              kind: [...element.classList]
                .filter((name) => /^HyperMD-/.test(name) && !/-(?:bg|nobullet)$/.test(name))
                .sort()
                .join(" "),
              // A list item's next line, which shows as more of its text.
              continuation: element.classList.contains("HyperMD-list-line-nobullet"),
              runs: runs(element, "", []),
            });
          else
            lines.set(at, {
              widget: [...element.classList].filter((name) => name !== "cm-embed-block").join(" "),
              html: widget(element),
            });
        }
        if (top + scroller.clientHeight >= scroller.scrollHeight) break;
      }
      // Reading view itself, for documents short enough that it renders all their sections.
      await leaf.setViewState({ type: "markdown", state: { file: path, mode: "preview" } });
      await settle(300);
      const preview =
        leaf.view.containerEl.querySelector(".markdown-preview-sizer")?.innerHTML ?? "";
      return {
        reading,
        preview,
        lines: [...lines].sort((a, b) => a[0] - b[0]).map(([, line]) => line),
      };
    },
    path,
    text,
  );
}

/**
 * HTML with the attributes that differ between equal renderings, or show nothing, removed. A
 * checked task's `data-task` is `x` or `X` as written, and both show the same checked box.
 */
function cleanHtml(html) {
  return (
    normalizeHtml(
      html
        .replace(
          /\s(?:dir|tabindex|draggable|contenteditable|spellcheck|style|aria-[\w-]+|data-(?:ignore-swipe|callout-metadata|callout-fold|line|heading)|id)="[^"]*"/g,
          "",
        )
        .replaceAll('data-task="X"', 'data-task="x"')
        // A footnote's identifiers end in a number that differs from one rendering to the next.
        .replace(/\b(fnref|fn)-([\d-]+)-[\da-f]{16}\b/g, "$1-$2"),
    )
      // Blank space at the end or start of a block, also inside inline elements, shows as nothing.
      .replace(new RegExp(` +((?:</(?:${inline})>)+)(?=</?(?:${block})[\\s>])`, "g"), "$1")
      .replace(
        new RegExp(`(<(?:${block})(?:\\s[^>]*)?>(?:<(?:${inline})(?:\\s[^>]*)?>)+) +`, "g"),
        "$1",
      )
  );
}
const inline = "a|b|code|del|em|i|mark|s|span|strong|u";
const block = "blockquote|div|h[1-6]|hr|li|ol|p|table|td|th|tr|ul";

/**
 * Live Preview's lines as the blocks a reader sees: the lines of one paragraph, list, or quote
 * joined as the spaces that their line breaks show as, and each text run with the classes that
 * style it. Blank lines separate blocks; a code block keeps every line.
 */
function livePreview(lines) {
  const blocks = [];
  let current;
  for (const line of lines) {
    if (line.widget !== undefined) {
      blocks.push(`<${line.widget}> ${cleanHtml(line.html)}`);
      current = undefined;
      continue;
    }
    const text = line.runs.map(([, value]) => value).join("");
    if (!line.kind && !text.trim()) {
      current = undefined;
      continue;
    }
    // The line that underlines a heading, which `style/heading` writes as `#` instead, and the
    // text above it, which has the heading's style but not its line's class.
    if (line.kind.includes("HyperMD-header-line")) continue;
    const level = line.runs
      .map(([classes]) => /\bcm-header-(\d)\b/.exec(classes)?.[1])
      .find(Boolean);
    if (!line.kind && level) line.kind = `HyperMD-header HyperMD-header-${level}`;
    const code = line.kind.includes("HyperMD-codeblock");
    // A lazy continuation line, without the markers of the list item or quote that it continues.
    const lazy = !line.kind && current && /HyperMD-(?:list-line|quote)/.test(current.kind);
    if (current && !code && (current.kind === line.kind || line.continuation || lazy)) {
      const last = current.runs.at(-1);
      const first = line.runs[0];
      current.runs.push([last && first && last[0] === first[0] ? last[0] : "", " "], ...line.runs);
    } else {
      current = { kind: line.kind, runs: [...line.runs], code };
      blocks.push(current);
    }
  }
  return blocks.map((block) => {
    if (typeof block === "string") return block;
    const merged = [];
    for (const [classes, value] of block.runs.filter(
      ([classes, value]) =>
        // Quote markers start lines, which wrapping moves, and a heading's underline goes
        // when `style/heading` writes it with `#`.
        !/\bcm-formatting-quote\b/.test(classes) &&
        !(/\bcm-formatting-header\b/.test(classes) && /^[\s=-]*$/.test(value)),
    )) {
      const last = merged.at(-1);
      if (last && last[0] === classes) last[1] += value;
      // Blank space between two runs of one style, such as a line's indentation, is in it.
      else if (
        !block.code &&
        last &&
        merged.length > 1 &&
        !last[0] &&
        !last[1].trim() &&
        merged.at(-2)[0] === classes
      ) {
        merged.pop();
        merged.at(-1)[1] += last[1] + value;
      } else merged.push([classes, value]);
    }
    // Blank space at the edges of a block shows as nothing.
    if (!block.code) {
      while (merged.length && !merged[0][1].trim()) merged.shift();
      while (merged.length && !merged.at(-1)[1].trim()) merged.pop();
      if (merged.length) {
        merged[0][1] = merged[0][1].trimStart();
        merged.at(-1)[1] = merged.at(-1)[1].trimEnd();
      }
    }
    const body = merged
      .map(([classes, value]) => {
        let text = block.code ? value : value.replace(/\s+/g, " ");
        // A list's marker shows as written: a bullet character, which the theme draws as a dot,
        // and an item's number, which `style/ordered-list` chooses.
        if (/\blist-bullet\b/.test(classes)) text = "•";
        else if (/\bcm-formatting-list-ol\b/.test(classes)) text = text.replace(/\d+[.)]/, "#.");
        else if (/\bcm-(?:hmd-barelink|link)\b/.test(classes))
          text = text.replace(/^X(?=\s|$)/, "x");
        // Unstyled text shows the source as written, where Live Preview reads no syntax, such as
        // after an HTML tag, and so does what it styles as a comment where Reading view reads
        // none, such as after `<!--` that nothing closes. Their words count, the syntax
        // characters that rules change do not, nor the case of a task's `x` or the number of a
        // list item there, which `style/ordered-list` chooses. Code counts as shown, also after
        // a backtick that nothing closes, which no rule changes (#362).
        if (!block.code && (!classes || /\bcm-comment\b/.test(classes))) {
          text = text
            .replace(/[^\p{L}\p{N}\s]/gu, "")
            .replace(/(^|\s)X(?=\s|$)/g, "$1x")
            .replace(/(^|\s)\d{1,9}(?=\s|$)/g, "$1#")
            .replace(/\s+/g, " ");
          if (classes) text = text.trim();
        }
        return classes ? `{${classes}}${text}{/}` : text;
      })
      .join("");
    return `[${block.kind}] ${block.code ? body : body.trim()}`;
  });
}

/** The documents to format: the fixtures, and `count` generated ones from the run's seed. */
function documents() {
  const generated = Array.from({ length: count }, (_, index) => {
    const documentNumber = documentSeed(seed, index);
    return {
      name: `generated ${documentNumber}`,
      source: generateDocument(documentNumber, "obsidian"),
    };
  });
  return [...fixtures, ...generated];
}

/** How many documents were written to the vault, which names the next ones. */
let written = 0;
/** A document's formatting at `width`, and the views in which Obsidian shows it differently. */
async function compare(source, width, workspace) {
  const config = {
    extends: ["recommended", "obsidian"],
    dialect: "obsidian",
    rules: { "style/wrap": ["warn", { width }] },
  };
  const result = format(source, { path: "Note.md", config, workspace });
  if (result.output === source) return { output: source, changed: [] };
  written++;
  const before = `cases/${written}-before.md`;
  const after = `cases/${written}-after.md`;
  await obsidianPage.write(before, source);
  await obsidianPage.write(after, result.output);
  const [shownBefore, shownAfter] = [
    await shown(before, source),
    await shown(after, result.output),
  ];
  const views = {
    livePreview: [livePreview(shownBefore.lines), livePreview(shownAfter.lines)],
    reading: [cleanHtml(shownBefore.reading), cleanHtml(shownAfter.reading)],
  };
  const changed = Object.entries(views)
    .filter(([, [one, other]]) => JSON.stringify(one) !== JSON.stringify(other))
    .map(([view]) => view);
  return { output: result.output, views, changed, before, after };
}

/**
 * With REDUCE set to names of generated documents (`generated 123,generated 456`), the check
 * removes lines from each while formatting still changes the same view, and reports the
 * smallest document it reaches, for an issue's minimal example.
 */
const reduce = process.env.REDUCE?.split(",")
  .map((name) => name.trim())
  .filter(Boolean);

/**
 * With PROBE set to a JSON array of documents, the check only shows each in Obsidian and
 * reports both views, to find out how Obsidian reads an input.
 */
const probe = process.env.PROBE ? JSON.parse(process.env.PROBE) : undefined;

describe("Obsidian before and after formatting", function () {
  it("shows the documents to probe", async function () {
    if (!probe) this.skip();
    const shownProbes = [];
    for (const [index, source] of probe.entries()) {
      const path = `probes/${index}.md`;
      await obsidianPage.write(path, source);
      const { reading, preview, lines } = await shown(path, source);
      const views = {
        reading: cleanHtml(reading),
        preview: cleanHtml(preview),
        livePreview: livePreview(lines),
      };
      shownProbes.push({ source, ...views });
      console.log(
        `${JSON.stringify(source)}\n  reading: ${views.reading}\n  reading view: ${views.preview}\n  live preview: ${JSON.stringify(views.livePreview)}`,
      );
    }
    writeFileSync("/out/probes.json", `${JSON.stringify(shownProbes, null, 2)}\n`);
  });

  it("reduces documents to the lines that show the difference", async function () {
    if (!reduce || probe) this.skip();
    const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
    const all = documents();
    const reduced = [];
    for (const name of reduce)
      for (const width of widths) {
        const named = all.find((item) => item.name === name);
        if (!named) continue;
        const first = await compare(named.source, width, workspace);
        if (!first.changed.length) continue;
        const view = first.changed.includes("reading") ? "reading" : first.changed[0];
        const still = async (lines) =>
          (await compare(lines.join("\n") + "\n", width, workspace)).changed.includes(view);
        let lines = named.source.replace(/\n$/, "").split("\n");
        for (let changed = true; changed;) {
          changed = false;
          // Halves, quarters, and so on, then single lines.
          for (let size = Math.max(1, lines.length >> 1); size >= 1; size >>= 1)
            for (let at = 0; at + size <= lines.length;) {
              const shorter = [...lines.slice(0, at), ...lines.slice(at + size)];
              if (shorter.length && (await still(shorter))) {
                lines = shorter;
                changed = true;
              } else at += size;
            }
        }
        const last = await compare(lines.join("\n") + "\n", width, workspace);
        reduced.push({
          name,
          width,
          view,
          source: lines.join("\n") + "\n",
          output: last.output,
          views: last.views,
        });
        console.log(`${name} at ${width}, ${view}:\n${lines.join("\n")}\n---`);
        break;
      }
    writeFileSync("/out/reduced.json", `${JSON.stringify(reduced, null, 2)}\n`);
  });

  it("shows the same in Live Preview and in Reading view", async function () {
    if (reduce || probe) this.skip();
    const version = await browser.executeObsidian(({ obsidian }) => obsidian.apiVersion);
    console.log(`Obsidian ${version}. Seed ${seed}; repeat with SEED=${seed}.`);
    const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
    const differences = [];
    let compared = 0;
    for (const width of widths)
      for (const { name, source } of documents()) {
        const { output, views, changed, before, after } = await compare(source, width, workspace);
        if (output === source) continue;
        compared++;
        if (!changed.length) continue;
        differences.push({ name, width, changed, source, output, views });
        if (differences.length <= 20) {
          const stem = `/out/${String(differences.length).padStart(2, "0")}`;
          await obsidianPage.openFile(before);
          await browser.saveScreenshot(`${stem}-before.png`);
          await obsidianPage.openFile(after);
          await browser.saveScreenshot(`${stem}-after.png`);
        }
      }
    const report = { obsidian: version, seed, count, widths, compared, differences };
    writeFileSync("/out/report.json", `${JSON.stringify(report, null, 2)}\n`);
    console.log(
      `Compared ${compared} formatted documents; ${differences.length} showed differently.`,
    );
    for (const { name, width, changed } of differences)
      console.log(`  ${name} at ${width} columns: ${changed.join(", ")}`);
    expect(differences.map(({ name, width }) => `${name} at ${width}`)).toEqual([]);
  });
});
