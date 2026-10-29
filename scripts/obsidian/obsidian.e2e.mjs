// The Obsidian check: formats documents with the repository's build and compares what Obsidian
// shows before and after, in Live Preview and in Reading view. It runs in the container that
// scripts/obsidian-check.mjs starts, with the repository mounted read-only at /repo, and writes
// its report to /out. SEED repeats a run's generated documents, COUNT sets how many there are.
import console from "node:console";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";
import { browser, expect } from "@wdio/globals";
import { obsidianPage } from "wdio-obsidian-service";

const { createWorkspace, format } = await import("/repo/dist/index.js");
const { documentSeed, generateDocument, normalizeHtml } =
  await import("/repo/scripts/rendering.mjs");
const { fixtures } = await import("/repo/tests/fixtures/renderers/obsidian.mjs");
const { rendererSettings } = await import("/repo/scripts/renderer-settings.mjs");
const { classifyDifferences, knownSources } =
  await import("/repo/scripts/renderer-differences.mjs");
const {
  createRendererReport,
  startDocument,
  validateRendererReport,
  obsidianWidths,
  obsidianControls,
} = await import("/repo/scripts/renderer-evidence.mjs");
const { default: baseline } = await import("/repo/scripts/obsidian/baseline.json", {
  with: { type: "json" },
});

const { profile, seeds, count } = rendererSettings(process.env);
/** Widths to format at: the preset's, and a narrow one that reflows nearly every paragraph. */
const widths = obsidianWidths;
const report = createRendererReport("obsidian", { profile, seeds, count });
report.widths = widths;
report.requested = {
  app: process.env.OBSIDIAN_VERSION || baseline.app,
  installer: process.env.OBSIDIAN_INSTALLER_VERSION || baseline.installer,
};
function checkpoint() {
  report.compared = report.documents.filter((item) =>
    item.views.some((view) => view.status === "compared"),
  ).length;
  writeFileSync("/out/report.json", `${JSON.stringify(report, null, 2)}\n`);
}
async function identifyHost() {
  report.identity = await browser.executeObsidian(({ obsidian, require }) => ({
    app: obsidian.apiVersion,
    installer: require("@electron/remote").app.getVersion(),
    electron: require("node:process").versions.electron,
    chrome: require("node:process").versions.chrome,
  }));
  report.identity.image = JSON.parse(process.env.OBSIDIAN_IMAGE);
  report.obsidian = report.identity.app;
}

/** Whether Obsidian has loaded the vault's settings, such as its strict line breaks. */
let loaded = false;
/** What Obsidian shows a note as, read in its page: Reading view's HTML and Live Preview's lines. */
async function shown(path, text) {
  // Until the settings are loaded, Obsidian renders with its defaults.
  if (!loaded) {
    loaded = await browser.executeObsidian(async ({ app }) => {
      for (let wait = 0; wait < 100 && app.vault.getConfig("strictLineBreaks") !== true; wait++)
        await new Promise((resolve) => setTimeout(resolve, 100));
      return app.vault.getConfig("strictLineBreaks") === true;
    });
    // The tool wraps only with strict line breaks, so a comparison without
    // them would check something else.
    if (!loaded) throw new Error("Obsidian did not load the vault's strict line breaks setting");
  }
  return browser.executeObsidian(
    async ({ app, obsidian, require }, path, text) => {
      const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
      // Background parsing can lag behind scrolling in long notes (#508).
      // forceParsing also dispatches the finished tree to the editor, so the
      // captured styles describe parsed content rather than temporary plain text.
      const language = require("@codemirror/language");
      if (!language.forceParsing(cm, cm.state.doc.length, 10000))
        throw new Error(`Live Preview did not parse all of ${path}`);
      await settle(100);

      // Reading view, through the renderer that it uses. Before any note was
      // open, its first rendering differed from Reading view's, as of a line
      // that holds only a tab, so it runs with the note open.
      const component = new obsidian.Component();
      component.load();
      const container = document.createElement("div");
      await obsidian.MarkdownRenderer.render(app, text, container, path, component);
      await settle(50);
      const rawReading = container.innerHTML;
      // Obsidian's default Reading-view styles give a lone list paragraph no
      // extra spacing (#528). Keep multiple paragraphs and attributed wrappers:
      // their boundaries or styling can be visible.
      for (const item of container.querySelectorAll("li")) {
        if (item.closest("section[data-footnotes], .footnotes")) continue;
        const paragraphs = [...item.children].filter((child) => child.tagName === "P");
        if (paragraphs.length !== 1 || paragraphs[0].attributes.length) continue;
        const paragraph = paragraphs[0];
        if (
          [...item.childNodes].some(
            (child) =>
              child !== paragraph &&
              (child.nodeType === Node.TEXT_NODE
                ? child.textContent.trim()
                : child.nodeType !== Node.ELEMENT_NODE || !child.matches("ul, ol")),
          )
        )
          continue;
        paragraph.replaceWith(...paragraph.childNodes);
      }
      // A generated display-math child is block-level even when its loaded
      // wrapper is a span. Adjacent collapsible ASCII margins show nothing
      // (#589); the mandatory real Reading-layout control checks that premise.
      for (const math of container.querySelectorAll(".math.math-block.is-loaded")) {
        if (math.closest("pre, code, textarea, [style]")) continue;
        const block = math.querySelector(
          ':scope > mjx-container.MathJax[jax="CHTML"][display="true"]',
        );
        if (
          !block ||
          math.childNodes.length !== 1 ||
          (block.style.display && block.style.display !== "block") ||
          !block.querySelector(':scope > mjx-math[display="true"][data-latex]')
        )
          continue;
        const before = math.previousSibling;
        const after = math.nextSibling;
        if (before?.nodeType === Node.TEXT_NODE)
          before.data = before.data.replace(/[ \t\r\n\f]+$/, "");
        if (after?.nodeType === Node.TEXT_NODE)
          after.data = after.data.replace(/^[ \t\r\n\f]+/, "");
      }
      const reading = container.innerHTML;
      component.unload();

      const ui =
        "img.cm-widgetBuffer, .cm-fold-indicator, .code-block-flair, svg, .embed-actions, .table-col-drag-handle, .table-row-drag-handle, .table-row-btn, .table-col-btn, .callout-icon, .collapse-indicator";
      const style =
        /^(?:cm-(?:strong|em|strikethrough|inline-code|highlight|link|url|hashtag|hmd-internal-link|link-alias|comment|hmd-barelink|header-\d|formatting[\w-]*|hmd-footnote|footref)|list-bullet|is-unresolved|task-list-item-checkbox)$/;
      /** The text of a line's content, as runs of [classes of what shows it, text]. */
      const embeds = ".internal-embed, .image-embed";
      /** What an embed shows: its file, with the description and size written for it. */
      const embedText = (element) => {
        const image = element.querySelector("img");
        const value = (name) => element.getAttribute(name) ?? image?.getAttribute(name);
        return (
          ["src", "alt", "width", "height"].map(value).filter(Boolean).join(" ") ||
          element.textContent
        );
      };
      const runs = (node, classes, out) => {
        for (const child of node.childNodes) {
          if (child.nodeType === Node.TEXT_NODE) {
            if (child.data) out.push([classes, child.data]);
            continue;
          }
          if (child.nodeType !== Node.ELEMENT_NODE || child.matches(ui)) continue;
          if (child.matches(".math")) {
            // A widget can sit outside Setext's styled text spans. Its inherited
            // typography can change while its LaTeX and captured classes agree.
            const font = globalThis.getComputedStyle(child);
            const typography = `font-size=${font.fontSize} font-weight=${font.fontWeight} line-height=${font.lineHeight}`;
            out.push([
              `${classes} math ${typography}`,
              child.querySelector("[data-latex]")?.dataset.latex ?? "",
            ]);
          } else if (child.matches(embeds)) out.push([`${classes} embed`, embedText(child)]);
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
        if (copy.classList.contains("cm-table-widget")) {
          const table = copy.querySelector(":scope > .table-wrapper > table.table-editor");
          for (const cell of table?.querySelectorAll("th, td") ?? []) {
            if (cell.closest("table") !== table) continue;
            const wrappers = [...cell.children].filter((child) =>
              child.classList.contains("table-cell-wrapper"),
            );
            if (wrappers.some((child) => !child.querySelector(".cm-editor"))) {
              for (const wrapper of wrappers) {
                if (
                  wrapper.getAttribute("data-ignore-swipe") === "true" &&
                  wrapper.querySelector(
                    ":scope > .cm-s-obsidian.mod-cm6.is-live-preview > .cm-editor",
                  )
                )
                  wrapper.remove();
              }
            }
            cell.classList.remove("mod-active-row-handle", "mod-active-col-handle");
            if (!cell.classList.length) cell.removeAttribute("class");
          }
        }
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
          // A line and a widget can share a position: with the cursor on a table's line,
          // as on a note's first line when it opens, Live Preview keeps an empty line of
          // the table next to the table's widget (#401). Lines sort before widgets there.
          const key = element.classList.contains("cm-line") ? at * 2 : at * 2 + 1;
          if (lines.has(key)) continue;
          if (element.classList.contains("cm-line"))
            lines.set(key, {
              // A lazy line of a quote shows as more of the quote.
              kind: [...element.classList]
                .filter((name) => /^HyperMD-/.test(name) && !/-(?:bg|nobullet|lazy)$/.test(name))
                .sort()
                .join(" "),
              // A list item's next line, which shows as more of its text.
              continuation: element.classList.contains("HyperMD-list-line-nobullet"),
              // Checkbox widgets hide the marker's classes. Its source family
              // still distinguishes adjacent lists with different delimiters (#512).
              marker: /^[ \t]*(\d{1,9}[.)]|[-+*])(?:[ \t]|$)/.exec(
                cm.state.doc.lineAt(at).text,
              )?.[1],
              runs: runs(element, "", []),
            });
          else
            lines.set(key, {
              widget: [...element.classList]
                .filter(
                  (name) =>
                    name !== "cm-embed-block" &&
                    !(element.classList.contains("cm-table-widget") && name === "has-focus"),
                )
                .join(" "),
              html: widget(element),
              // An embed on a line of its own shows as a block, also where a wrapper
              // holds it.
              embed: (() => {
                const target = element.matches(embeds)
                  ? element
                  : [...element.children].find((child) => child.matches(embeds));
                return target && embedText(target);
              })(),
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
        rawReading,
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
  // The column where the list item's content starts, for the lines of a code block in it.
  let content;
  for (let line of lines) {
    // An unchecked widget is visible even though its captured value is blank.
    // Give it content before whitespace trimming and soft-line joining (#522).
    if (line.runs?.some(([classes]) => /\bcheckbox\b/.test(classes)))
      line = {
        ...line,
        runs: line.runs.map(([classes, value]) => [
          classes,
          /\bcheckbox\b/.test(classes) ? (value.trim() ? "[x]" : "[ ]") : value,
        ]),
      };
    // An embed that Live Preview shows as a block where the source gives it a line of its
    // own, which wrapping can do, shows the same file as an embed in the line.
    if (line.embed) line = { kind: "", runs: [[" embed", line.embed]] };
    if (line.widget !== undefined) {
      blocks.push(`<${line.widget}> ${cleanHtml(line.html)}`);
      current = undefined;
      continue;
    }
    // A table's `HyperMD-table-1` or `-2` says whether its rows begin with a pipe, which
    // `style/table` chooses (#401), and the first line of a block quote in a list item carries
    // the item's classes, which the quote's other lines do not (#410); neither shows.
    const quoted = /\bHyperMD-quote\b/.test(line.kind);
    const kind = line.kind
      .split(" ")
      .filter(
        (name) => !/^HyperMD-table-\d+$/.test(name) && !(quoted && /^HyperMD-list-line/.test(name)),
      )
      .join(" ");
    if (kind !== line.kind) line = { ...line, kind, continuation: line.continuation && !quoted };
    const text = line.runs.map(([, value]) => value).join("");
    // A line that shows only an image is not blank.
    const embed = line.runs.some(([classes]) => /\bembed\b/.test(classes));
    // A blank line below a footnote definition takes its class, and shows nothing either.
    if (
      (!line.kind || line.kind === "HyperMD-footnote" || /^HyperMD-table-row\b/.test(line.kind)) &&
      !text.trim() &&
      !embed
    ) {
      current = undefined;
      continue;
    }
    // A line of a list item or block quote that shows only blank space after its markers,
    // such as a line of spaces in an item or `>` alone, is a blank line too, and ends the
    // block (#400). An empty list item shows its marker, and is not one.
    const shownText = afterQuotes(line.runs)
      .map(([, value]) => value)
      .join("");
    if (
      !line.kind.includes("HyperMD-codeblock") &&
      (line.continuation || quoted) &&
      !shownText.trim() &&
      !embed
    ) {
      current = undefined;
      continue;
    }
    // The line that underlines a heading, which `style/heading` writes as `#` instead, and the
    // text above it, which has the heading's style but not its line's class.
    const styledUnderline =
      /\bHyperMD-header\b/.test(line.kind) &&
      /^(?:=+|-+)$/.test(text.trim()) &&
      line.runs.every(
        ([classes, value]) => !value.trim() || /\bcm-formatting-header\b/.test(classes),
      );
    if (line.kind.includes("HyperMD-header-line") || styledUnderline) {
      current = undefined;
      continue;
    }
    // Native heading lines start separate visible blocks, even at the same
    // level without a blank separator (#544). Inferred Setext text below keeps
    // its existing soft-line handling; its underline ends the heading above.
    const headingStart = /\bHyperMD-header\b/.test(line.kind);
    const level = line.runs
      .map(([classes]) => /\bcm-header-(\d)\b/.exec(classes)?.[1])
      .find(Boolean);
    if (!line.kind && level) line.kind = `HyperMD-header HyperMD-header-${level}`;
    const code = line.kind.includes("HyperMD-codeblock");
    // A code block in a list item shows the list's indentation, which the list rules choose, on
    // each of its lines: the blank space before the item's marker on the line that opens the
    // block, or before its fence there without one, and the columns up to the item's content
    // on the lines below. What is left is the code's own indentation.
    if (code && line.kind.includes("HyperMD-list-line")) {
      if (line.kind.includes("HyperMD-codeblock-begin")) {
        const lead = blankStart(line.runs);
        content = listContent(line.runs) ?? lead;
        line = { ...line, runs: outdent(line.runs, lead) };
      } else if (content !== undefined) line = { ...line, runs: outdent(line.runs, content) };
    } else content = undefined;
    // Normalize source-only list numbers before joining lines or removing punctuation
    // (#735). Keep a canonical zero so the marker still contributes content.
    // A plain number or numeric hashtag is content, not a list marker.
    if (!code) {
      let prefix = true;
      line = {
        ...line,
        runs: line.runs.map(([classes, value]) => {
          const eligible = prefix && (!classes || /\bcm-comment\b/.test(classes));
          prefix &&= !value.trim() || /\bcm-formatting-quote\b/.test(classes);
          return [
            classes,
            eligible
              ? value.replace(
                  /^[ \t]*(?:(?:>[ \t]*)|(?:(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$)))+/gm,
                  (markers) => markers.replace(/\d{1,9}(?=[.)])/g, "0"),
                )
              : value,
          ];
        }),
      };
    }
    // Adjacent ordered and unordered lists are distinct blocks even without a
    // blank line (#440). Only an actual styled leading marker supplies that
    // distinction: unstyled `-` or `1.` in quotes or HTML remains paragraph text.
    const leading = line.runs.find(([, value]) => value.trim());
    const listFamily =
      !code && !quoted && line.kind.includes("HyperMD-list-line")
        ? (/\bcm-formatting-list-(ol|ul)\b/.exec(leading?.[0] ?? "")?.[1] ??
          (line.runs.some(([classes]) => /\bcheckbox\b/.test(classes)) && line.marker
            ? /^\d/.test(line.marker)
              ? "ol"
              : "ul"
            : undefined))
        : undefined;
    const listDelimiter = listFamily && line.marker?.at(-1);
    // A marker-only line loses its styled trailing space when soft lines join,
    // while a marker beside text keeps it. The separator has the same role in
    // both forms (#443); keep the numeric marker's classes and space separately.
    const ordered =
      listFamily === "ol" &&
      leading &&
      !/\bcm-inline-code\b/.test(leading[0]) &&
      /^(\d+[.)])([ \t]+)$/.exec(leading[1]);
    if (ordered)
      line = {
        ...line,
        runs: line.runs.flatMap((run) =>
          run === leading
            ? [
                [run[0], ordered[1]],
                ["", ordered[2]],
              ]
            : [run],
        ),
      };
    const differentList =
      current?.kind === line.kind &&
      current.listFamily &&
      listFamily &&
      (current.listFamily !== listFamily ||
        (current.listDelimiter && listDelimiter && current.listDelimiter !== listDelimiter));
    // A lazy continuation line, without the markers of the list item or quote that it continues.
    const lazy = !line.kind && current && /HyperMD-(?:list-line|quote)/.test(current.kind);
    if (
      current &&
      !code &&
      !differentList &&
      !headingStart &&
      (current.kind === line.kind || line.continuation || lazy)
    ) {
      if (listFamily) current.listFamily = listFamily;
      if (listDelimiter) current.listDelimiter = listDelimiter;
      // The runs on each side of the line break that show text, not a line's quote markers,
      // which wrapping moves, or a nested quote's `>`, which Live Preview leaves unstyled.
      const shows = ([classes, value]) =>
        value.trim() &&
        !/\bcm-formatting-quote\b/.test(classes) &&
        !(!classes && /^[\s>]*$/.test(value));
      const last = current.runs.findLast(shows);
      const first = line.runs.find(shows);
      // Blank space at the end of the line outside inline code shows as nothing, whatever
      // styles it (#406, #421).
      while (current.runs.length) {
        const [classes, value] = current.runs.at(-1);
        if (/\bcm-inline-code\b/.test(classes)) break;
        if (value.trimEnd()) {
          current.runs[current.runs.length - 1] = [classes, value.trimEnd()];
          break;
        }
        current.runs.pop();
      }
      current.runs.push([last && first && last[0] === first[0] ? last[0] : "", " "], ...line.runs);
    } else {
      current = { kind: line.kind, runs: [...line.runs], code, listFamily, listDelimiter };
      blocks.push(current);
    }
  }
  const normalized = blocks.map((block) => {
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
        // A code block's fence, whose characters and length `style/code-fence` chooses.
        else if (/\bcm-formatting-code-block\b/.test(classes)) {
          // Blank space between an opening fence and its info string is a
          // separator too, which `style/code-fence` removes and the language
          // reading ignores (#715).
          text = /\bHyperMD-codeblock-begin\b/.test(block.kind)
            ? text.replace(/^(?:`{3,}|~{3,})[ \t]*/, "```")
            : text.replace(/^(?:`{3,}|~{3,})/, "```");
          // Source-only trailing separators on a styled fence carry no code
          // or info-string content (#533). Code body and internal info spaces
          // remain exact, as do unstyled text runs that happen to contain ticks.
          if (/\bHyperMD-codeblock-(?:begin|end)\b/.test(block.kind))
            text = text.replace(/[ \t]+$/, "");
        } else if (/\bcm-formatting-list-ol\b/.test(classes)) text = text.replace(/\d+[.)]/, "#.");
        else if (/\bcm-(?:hmd-barelink|link)\b/.test(classes))
          text = text.replace(/^X(?=\s|$)/, "x");
        // Unstyled text shows the source as written, where Live Preview reads no syntax, such as
        // after an HTML tag, and so does what it styles as a comment where Reading view reads
        // none, such as after `<!--` that nothing closes. Their words count, the syntax
        // characters that rules change do not, nor the case of a task's `x` or a callout's type
        // there (#403). Code counts as shown, also after a backtick that nothing
        // closes, which no rule changes (#362).
        if (!block.code && (!classes || /\bcm-comment\b/.test(classes))) {
          text = text
            .replace(/\[!([^\]\s]+)\]/g, (_, type) => `[!${type.toLowerCase()}]`)
            .replace(/[^\p{L}\p{N}\s]/gu, "")
            .replace(/(^|\s)X(?=\s|$)/g, "$1x")
            .replace(/\s+/g, " ");
          if (classes) text = text.trim();
        }
        return [classes, text];
      })
      // Wrapping can split an italic or bold run around a separating space.
      // Keep every space plain, including inside a run, and compare the styling
      // of visible text rather than this incidental boundary (#514). Code and styles
      // with visible backgrounds or decorations retain their whitespace.
      .flatMap(([classes, text]) => {
        if (
          block.code ||
          !classes ||
          !classes.split(" ").every((name) => name === "cm-em" || name === "cm-strong")
        )
          return [[classes, text]];
        return text.split(/(\s+)/).map((part) => [part.trim() ? classes : "", part]);
      })
      // Unstyled text that shows nothing, such as a nested quote's `>`, separates nothing.
      .filter(([classes, text]) => classes || text)
      .reduce((runs, [classes, text]) => {
        const last = runs.at(-1);
        if (last && last[0] === classes) last[1] += text;
        else runs.push([classes, text]);
        return runs;
      }, [])
      .map(([classes, text]) =>
        classes ? `{${classes}}${text}{/}` : block.code ? text : text.replace(/\s+/g, " "),
      )
      .join("");
    // Source-only punctuation already contributes no content above (#545).
    // Omit its empty unstyled record after grouping, retaining all real block
    // kinds and the paragraph boundaries established by blank-line resets.
    if (!block.kind && !block.code && !body.trim()) return undefined;
    return `[${block.kind}] ${block.code ? body : body.trim()}`;
  });
  return normalized.filter((block) => block !== undefined);
}

/** A line's runs after its quote markers, which wrapping moves. */
function afterQuotes(runs) {
  const start = runs.findIndex(([classes]) => !/\bcm-formatting-quote\b/.test(classes));
  return start < 0 ? [] : runs.slice(start);
}

/** How many characters of blank space a line starts with after its quote markers. */
function blankStart(runs) {
  let count = 0;
  for (const [, value] of afterQuotes(runs)) {
    const blank = /^[ \t]*/.exec(value)[0].length;
    count += blank;
    if (blank < value.length) break;
  }
  return count;
}

/** Where a line's list item shows its content, after its quote markers, if it has a marker. */
function listContent(runs) {
  let column = 0;
  let content;
  for (const [classes, value] of afterQuotes(runs)) {
    column += value.length;
    if (/\bcm-formatting-list\b/.test(classes)) content = column;
  }
  return content;
}

/** A line's runs without up to `count` characters of blank space after its quote markers. */
function outdent(runs, count) {
  const quotes = runs.length - afterQuotes(runs).length;
  return runs.flatMap(([classes, value], index) => {
    if (index < quotes || !count) return [[classes, value]];
    const cut = Math.min(count, /^[ \t]*/.exec(value)[0].length);
    count = cut === value.length ? count - cut : 0;
    return cut === value.length ? [] : [[classes, value.slice(cut)]];
  });
}

/** The documents to format: the fixtures, and `count` generated ones from the run's seed. */
function documents() {
  const generated = seeds.flatMap((seed) =>
    Array.from({ length: count }, (_, index) => ({
      name: `generated ${seed}/${index}`,
      source: generateDocument(documentSeed(seed, index), "obsidian", profile),
    })),
  );
  const retained =
    profile === "adversarial"
      ? knownSources("obsidian").map((source, index) => ({ name: `known ${index}`, source }))
      : [];
  return [...fixtures, ...generated, ...retained];
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

/** A missing, skipped or failed calibration cannot certify a completed native run. */
function it(title, body) {
  if (!obsidianControls.includes(title)) return globalThis.it(title, body);
  globalThis.it(title, async function () {
    if (probe || reduce) this.skip();
    const outcome = { name: title, passed: false };
    report.controls.push(outcome);
    try {
      if (!report.identity) await identifyHost();
      await body.call(this);
      outcome.passed = true;
    } finally {
      checkpoint();
    }
  });
}

describe("Obsidian before and after formatting", function () {
  it("retains rendered table content while a real cell editor owns focus (#550)", async function () {
    if (probe || reduce) this.skip();
    // Capture with the exact production runs/widget/class/scroll body. Real
    // WebDriver input must occur between opening the note and this capture;
    // shown() stays one page callback for ordinary corpus comparisons.
    const spec = readFileSync("/repo/scripts/obsidian/obsidian.e2e.mjs", "utf8");
    const start = spec.indexOf("      const ui =");
    const end = spec.indexOf("      // Reading view itself,", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const capture = new Function(`return async function ({ app }, path, source) {
      const leaf = app.workspace.getLeaf(false);
      if (leaf.view.file?.path !== path) throw new Error("Wrong table-focus fixture");
      const cm = leaf.view.editor.cm;
      const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
      ${spec.slice(start, end)}
      const authored = document.createElement("div");
      authored.className = "cm-table-widget markdown-rendered";
      authored.innerHTML = '<div class="table-wrapper"><table class="table-editor"><tbody><tr><td><div class="table-cell-wrapper">outer<table><tbody><tr><td class="mod-active-row-handle mod-active-col-handle"><div class="table-cell-wrapper">authored preview</div><div class="table-cell-wrapper" data-ignore-swipe="true"><div class="cm-s-obsidian mod-cm6 is-live-preview"><div class="cm-editor">authored payload</div></div></div></td></tr></tbody></table></div></td></tr></tbody></table></div>';
      const authoredBefore = authored.innerHTML;
      const authoredAfter = widget(authored);
      return {
        lines: [...lines].sort((a,b) => a[0] - b[0]).map(([, line]) => line),
        sourceUnchanged: cm.state.doc.toString() === source,
        nestedEditorFocused: [...cm.contentDOM.querySelectorAll(".cm-table-widget .cm-editor")].some(editor => editor.contains(document.activeElement)),
        authoredBefore, authoredAfter,
      };
    }`)();
    const cases = [
      {
        name: "styled header",
        source:
          "| **header**                              | second |\n| --------------------------------------- | ------ |\n| _body_                                  | `a  b` |\n| near [label](https://example.com/first) | final  |\n",
        selector: "thead tr:first-child th:first-child",
        equal: true,
      },
      {
        name: "code cell",
        source:
          "| **header**                              | second |\n| --------------------------------------- | ------ |\n| _body_                                  | `a  b` |\n| near [label](https://example.com/first) | final  |\n",
        selector: "tbody tr:first-child td:nth-child(2)",
        equal: true,
      },
      {
        name: "link cell beside plain text",
        source:
          "| **header**                              | second |\n| --------------------------------------- | ------ |\n| _body_                                  | `a  b` |\n| near [label](https://example.com/first) | final  |\n",
        selector: "tbody tr:nth-child(2) td:first-child",
        equal: true,
      },
      {
        name: "different header text",
        source:
          "| **changed**                             | second |\n| --------------------------------------- | ------ |\n| _body_                                  | `a  b` |\n| near [label](https://example.com/first) | final  |\n",
        selector: "thead tr:first-child th:first-child",
        equal: false,
      },
      {
        name: "different header style",
        source:
          "| header                                  | second |\n| --------------------------------------- | ------ |\n| _body_                                  | `a  b` |\n| near [label](https://example.com/first) | final  |\n",
        selector: "thead tr:first-child th:first-child",
        equal: false,
      },
      {
        name: "different code spacing",
        source:
          "| **header**                              | second |\n| --------------------------------------- | ------ |\n| _body_                                  | `a b`  |\n| near [label](https://example.com/first) | final  |\n",
        selector: "thead tr:first-child th:first-child",
        equal: false,
      },
      {
        name: "different alignment",
        source:
          "| **header**                              | second |\n| --------------------------------------: | ------ |\n| _body_                                  | `a  b` |\n| near [label](https://example.com/first) | final  |\n",
        selector: "thead tr:first-child th:first-child",
        equal: false,
      },
      {
        name: "different row count",
        source:
          "| **header**                              | second |\n| --------------------------------------- | ------ |\n| _body_                                  | `a  b` |\n| near [label](https://example.com/first) | final  |\n| extra                                   | row    |\n",
        selector: "thead tr:first-child th:first-child",
        equal: false,
      },
      {
        name: "different link destination",
        source:
          "| **header**                               | second |\n| ---------------------------------------- | ------ |\n| _body_                                   | `a  b` |\n| near [label](https://example.com/second) | final  |\n",
        selector: "thead tr:first-child th:first-child",
        equal: false,
      },
    ];
    const records = [];
    let baseline;
    for (const [index, { name, source, selector, equal }] of cases.entries()) {
      const path = `controls/table-focus-${index}.md`;
      await obsidianPage.write(path, source);
      const natural = await shown(path, source);
      const target = await browser.executeObsidian(
        async ({ app, require }, path, selector) => {
          const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          const leaf = app.workspace.getLeaf(false);
          await leaf.openFile(app.vault.getFileByPath(path), {
            active: true,
            state: { mode: "source", source: false },
          });
          const cm = leaf.view.editor.cm;
          cm.contentDOM.blur();
          await settle(150);
          if (!require("@codemirror/language").forceParsing(cm, cm.state.doc.length, 10000))
            throw new Error("Table-focus fixture did not parse");
          cm.scrollDOM.scrollTop = 0;
          await settle(100);
          const cell = cm.contentDOM.querySelector(".cm-table-widget")?.querySelector(selector);
          if (!cell) throw new Error("Table-focus cell not found: " + selector);
          cell.setAttribute("data-mdrefine-table-focus", "target");
          const alreadyEditing = !!cell
            .querySelector(".cm-editor")
            ?.contains(document.activeElement);
          if (!cell.querySelector("a")) return { alreadyEditing };
          const rect = cell.getBoundingClientRect();
          for (const x of [rect.right - 20, rect.left + 10, rect.left + rect.width / 2]) {
            const y = rect.top + rect.height / 2;
            const hit = document.elementFromPoint(x, y);
            if (
              hit &&
              cell.contains(hit) &&
              !hit.closest("a, input, .table-row-drag-handle, .table-col-drag-handle")
            )
              return { alreadyEditing, point: { x: Math.round(x), y: Math.round(y) } };
          }
          throw new Error("No non-link click point in the table-focus fixture");
        },
        path,
        selector,
      );
      if (!target.alreadyEditing) {
        if (target.point) {
          await browser
            .action("pointer")
            .move(target.point.x, target.point.y)
            .down({ button: 0 })
            .up({ button: 0 })
            .pause(80)
            .down({ button: 0 })
            .up({ button: 0 })
            .perform();
        } else await (await browser.$('[data-mdrefine-table-focus="target"]')).doubleClick();
      }
      const focused = await browser.executeObsidian(
        async ({ app }, path, selector) => {
          const leaf = app.workspace.getLeaf(false);
          for (let wait = 0; wait < 20; wait++) {
            const cell = leaf.view.editor.cm.contentDOM
              .querySelector(".cm-table-widget")
              ?.querySelector(selector);
            const editor = cell?.querySelector(".cm-editor");
            if (leaf.view.file?.path === path && editor?.contains(document.activeElement)) {
              cell.removeAttribute("data-mdrefine-table-focus");
              return true;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return false;
        },
        path,
        selector,
      );
      expect({ [name]: focused }).toEqual({ [name]: true });
      const captured = await browser.executeObsidian(capture, path, source);
      const before = livePreview(natural.lines);
      const after = livePreview(captured.lines);
      const reading = cleanHtml(natural.reading);
      records.push({ name, source, selector, equal, before, after, reading, ...captured });
      writeFileSync("/out/table-focus-controls.json", JSON.stringify(records, null, 2));
      if (index < 3) await browser.saveScreenshot(`/out/table-focus-${index}.png`);
      expect(captured.nestedEditorFocused).toBe(true);
      expect(captured.sourceUnchanged).toBe(true);
      expect(captured.authoredAfter).toEqual(captured.authoredBefore);
      expect({ [name]: after }).toEqual({ [name]: before });
      baseline ??= { livePreview: before, reading };
      if (equal) {
        expect({ [name]: after }).toEqual({ [name]: baseline.livePreview });
        expect({ [name]: reading }).toEqual({ [name]: baseline.reading });
      } else {
        expect({ [name]: after }).not.toEqual({ [name]: baseline.livePreview });
        expect({ [name]: reading }).not.toEqual({ [name]: baseline.reading });
      }
    }
  });

  it("retains heading boundaries while ignoring their optional blank separators (#544)", async function () {
    if (probe || reduce) this.skip();
    const sources = [
      "## alpha\n## beta\n",
      "## alpha\n\n## beta\n",
      "alpha\n---\nbeta\n---\n",
      "## alpha beta\n",
      "## alpha\n### beta\n",
      "## alpha\n## *beta*\n",
      "## alpha\n## gamma\n",
      "## alpha ![[first.png]]\n## beta\n",
      "## alpha ![[second.png]]\n## beta\n",
    ];
    const views = [];
    for (const [index, source] of sources.entries()) {
      const path = `controls/heading-boundary-${index}.md`;
      await obsidianPage.write(path, source);
      views.push(await shown(path, source));
    }
    const normalized = views.map(({ lines }) => livePreview(lines));
    expect(normalized[0]).toEqual(normalized[1]);
    expect(normalized[0]).toEqual(normalized[2]);
    expect(cleanHtml(views[0].reading)).toEqual(cleanHtml(views[1].reading));
    expect(cleanHtml(views[0].reading)).toEqual(cleanHtml(views[2].reading));
    expect(normalized[0]).toHaveLength(2);
    for (const changed of normalized.slice(3, 7)) expect(normalized[0]).not.toEqual(changed);
    expect(normalized[7]).not.toEqual(normalized[8]);
  });

  it("retains inherited math typography across heading forms (#383, #569)", async function () {
    if (probe || reduce) this.skip();
    const cases = [
      ["sole math", "$x$\n---\n", "## $x$\n", false],
      ["two leading widgets", "$x$ $y$\n---\n", "## $x$ $y$\n", false],
      ["leading math before a comment", "$x$%%note%%\n---\n", "## $x$%%note%%\n", false],
      ["text before math", "before $x$ after\n---\n", "## before $x$ after\n", true],
      ["wrapped math", "*$x$*\n---\n", "## _$x$_\n", true],
    ];
    const views = new Map();
    for (const [index, source] of [...new Set(cases.flatMap(([, a, b]) => [a, b]))].entries()) {
      const path = `controls/math-typography-${index}.md`;
      await obsidianPage.write(path, source);
      views.set(source, await shown(path, source));
    }
    for (const [name, source, paired, equal] of cases) {
      const before = views.get(source),
        after = views.get(paired);
      expect({ name, reading: cleanHtml(before.reading) }).toEqual({
        name,
        reading: cleanHtml(after.reading),
      });
      const same =
        JSON.stringify(livePreview(globalThis.structuredClone(before.lines))) ===
        JSON.stringify(livePreview(globalThis.structuredClone(after.lines)));
      expect({ name, same }).toEqual({ name, same: equal });
    }
  });

  it("normalizes styled Setext markers while retaining real heading content (#544)", async function () {
    if (probe || reduce) this.skip();
    const cases = [
      ["single equals", "alpha\n=\n", "# alpha\n", true],
      ["single equals at EOF", "alpha\n=", "# alpha\n", true],
      ["long equals", "alpha\n===\n", "# alpha\n", true],
      ["styled content", "*alpha* beta\n=\n", "# _alpha_ beta\n", true],
      ["adjacent Setext headings", "alpha\n=\nbeta\n=\n", "# alpha\n# beta\n", true],
      ["optional heading blank", "# alpha\n# beta\n", "# alpha\n\n# beta\n", true],
      ["multiline Setext styles", "alpha\nbeta\n=\n", "# alpha beta\n", false],
      ["dash underline", "alpha\n---\n", "## alpha\n", true],
      ["literal equals content", "# =\n", "#\n", false],
      ["empty native heading", "#\n# alpha\n", "# alpha\n", false],
      ["heading level", "# alpha\n# beta\n", "# alpha\n## beta\n", false],
      ["heading styling", "# alpha\n# *beta*\n", "# alpha\n# **beta**\n", false],
    ];
    const sources = [...new Set(cases.flatMap(([, source, paired]) => [source, paired]))];
    const views = new Map();
    for (const [index, source] of sources.entries()) {
      const path = `controls/setext-marker-${index}.md`;
      await obsidianPage.write(path, source);
      views.set(source, await shown(path, source));
    }
    const normalized = (source) => livePreview(globalThis.structuredClone(views.get(source).lines));
    for (const [name, source, paired, equal] of cases) {
      const before = {
        livePreview: normalized(source),
        reading: cleanHtml(views.get(source).reading),
      };
      const after = {
        livePreview: normalized(paired),
        reading: cleanHtml(views.get(paired).reading),
      };
      if (equal) expect({ [name]: before }).toEqual({ [name]: after });
      else {
        expect({ [name]: before.livePreview }).not.toEqual({ [name]: after.livePreview });
        expect({ [name]: before.reading }).not.toEqual({ [name]: after.reading });
      }
    }
    expect(normalized("alpha\n=\nbeta\n=\n")).toHaveLength(2);
  });

  it("omits raw-source empty records while retaining visible paragraph splits (#545)", async function () {
    if (probe || reduce) this.skip();
    const cases = [
      [
        "open HTML",
        "<div> raw\n\n## Heading\n\n***\nnext\n=\n",
        "<div> raw\n\n## Heading\n\n---\n\nnext\n=\n",
        true,
      ],
      [
        "closed HTML",
        "<div> raw\n</div>\n\n## Heading\n\n***\nnext\n=\n",
        "<div> raw\n</div>\n\n## Heading\n\n---\n\nnext\n=\n",
        true,
      ],
      [
        "visible paragraph split",
        "<div> raw\n\nbefore\n***\nafter\n",
        "<div> raw\n\nbefore\n\n---\n\nafter\n",
        false,
      ],
      [
        "equal surrounding blanks",
        "<div> raw\n\nbefore\n\n***\n\nafter\n",
        "<div> raw\n\nbefore\n\n---\n\nafter\n",
        true,
      ],
    ];
    const sources = [...new Set(cases.flatMap(([, source, paired]) => [source, paired]))];
    const views = new Map();
    for (const [index, source] of sources.entries()) {
      const path = `controls/empty-source-record-${index}.md`;
      await obsidianPage.write(path, source);
      views.set(source, await shown(path, source));
    }
    const normalized = (source) => livePreview(globalThis.structuredClone(views.get(source).lines));
    for (const [name, source, paired, equal] of cases) {
      if (equal) expect({ [name]: normalized(source) }).toEqual({ [name]: normalized(paired) });
      else expect({ [name]: normalized(source) }).not.toEqual({ [name]: normalized(paired) });
      // Reading view agrees even when raw Live Preview has a real paragraph split.
      expect({ [name]: cleanHtml(views.get(source).reading) }).toEqual({
        [name]: cleanHtml(views.get(paired).reading),
      });
    }
  });

  it("normalizes styled fence separators while retaining code and info content (#533)", async function () {
    if (probe || reduce) this.skip();
    const sources = [
      "~~~js  \nx\n",
      "```js\nx\n",
      "~~~js\nx  \n",
      "~~~js one  two\nx\n",
      "~~~js one two\nx\n",
    ];
    const views = [];
    for (const [index, source] of sources.entries()) {
      const path = `controls/fence-info-${index}.md`;
      await obsidianPage.write(path, source);
      views.push(await shown(path, source));
    }
    expect(
      views[0].lines.some((line) => line.runs.some(([, value]) => value.endsWith("js  "))),
    ).toBe(true);
    expect(livePreview(views[0].lines)).toEqual(livePreview(views[1].lines));
    expect(cleanHtml(views[0].reading)).toEqual(cleanHtml(views[1].reading));
    expect(cleanHtml(views[2].reading)).not.toEqual(cleanHtml(views[1].reading));
    expect(livePreview(views[3].lines)).not.toEqual(livePreview(views[4].lines));
  });

  it("checks invisible block-math margins against real Reading layout (#589)", async function () {
    if (probe || reduce) this.skip();
    const sources = {
      prose: "alpha $$x = y$$\nbeta\n",
      joined: "alpha $$x = y$$ beta\n",
      marker: "- $$x = y$$\n  beta\n",
      markerJoined: "- $$x = y$$ beta\n",
      tight: "alpha$$x = y$$beta\n",
      word: "gamma $$x = y$$ beta\n",
      content: "alpha $$x = z$$ beta\n",
      inline: "alpha $x = y$ beta\n",
      inlineTight: "alpha $x = y$beta\n",
    };
    const records = {};
    for (const [name, source] of Object.entries(sources)) {
      const path = `controls/block-math-${name}.md`;
      await obsidianPage.write(path, source);
      const view = await shown(path, source);
      let layout;
      try {
        layout = await browser.executeObsidian(
          ({ app, obsidian }, path, styleMutant) => {
            const leaf = app.workspace.getLeaf(false);
            if (leaf.view.file?.path !== path) throw new Error("Wrong Reading control note");
            const root = leaf.view.containerEl.querySelector(".markdown-preview-sizer");
            if (!root?.isConnected) throw new Error("Real Reading pane is missing");
            const measure = () => {
              const origin = root.getBoundingClientRect();
              const rectangle = (rect) => ({
                left: rect.left - origin.left,
                top: rect.top - origin.top,
                width: rect.width,
                height: rect.height,
              });
              const words = [];
              const walker = document.createTreeWalker(root, globalThis.NodeFilter.SHOW_TEXT);
              while (walker.nextNode()) {
                const node = walker.currentNode;
                if (node.parentElement.closest(".math")) continue;
                for (const match of node.textContent.matchAll(/\b(?:alpha|beta|gamma)\b/g)) {
                  const range = document.createRange();
                  range.setStart(node, match.index);
                  range.setEnd(node, match.index + match[0].length);
                  words.push({
                    text: match[0],
                    rectangle: rectangle(range.getBoundingClientRect()),
                  });
                }
              }
              const maths = [...root.querySelectorAll(".math.is-loaded")].map((math) => ({
                block: math.classList.contains("math-block"),
                display: globalThis.getComputedStyle(math).display,
                rectangle: rectangle(math.getBoundingClientRect()),
                children: [...math.querySelectorAll(":scope > mjx-container")].map((child) => ({
                  writtenDisplay: child.getAttribute("display"),
                  display: globalThis.getComputedStyle(child).display,
                  rectangle: rectangle(child.getBoundingClientRect()),
                })),
              }));
              return { apiVersion: obsidian.apiVersion, words, maths };
            };
            const initial = measure();
            let mutant = null;
            if (styleMutant) {
              const child = root.querySelector(
                '.math.math-block.is-loaded > mjx-container[display="true"]',
              );
              if (!child) throw new Error("Loaded generated block-math child is missing");
              const style = child.getAttribute("style");
              try {
                // Actual native CSS mutation, not a fabricated Node geometry object.
                child.style.setProperty("display", "inline", "important");
                mutant = measure();
              } finally {
                if (style === null) child.removeAttribute("style");
                else child.setAttribute("style", style);
              }
            }
            return { initial, mutant, restored: measure() };
          },
          path,
          name === "prose",
        );
      } catch (error) {
        records[name] = { source, ...view, error: String(error) };
        writeFileSync("/out/block-math-controls.json", `${JSON.stringify(records, null, 2)}\n`);
        throw error;
      }
      records[name] = { source, ...view, layout };
      writeFileSync("/out/block-math-controls.json", `${JSON.stringify(records, null, 2)}\n`);
    }
    const reading = (name) => cleanHtml(records[name].reading);
    const geometry = (name) => records[name].layout.initial;
    const requireBlock = (layout) => {
      expect(layout.maths).toHaveLength(1);
      expect(layout.maths[0].block).toBe(true);
      expect(layout.maths[0].children).toHaveLength(1);
      expect(layout.maths[0].children[0].writtenDisplay).toBe("true");
      expect(layout.maths[0].children[0].display).toBe("block");
    };
    for (const name of ["prose", "joined", "marker", "markerJoined", "tight", "word", "content"])
      requireBlock(geometry(name));
    // A changed default style fails the normal requirement above; prove the
    // same requirement also rejects an actual, restored native style mutation.
    expect(records.prose.layout.mutant).not.toBeNull();
    expect(() => requireBlock(records.prose.layout.mutant)).toThrow();
    expect(records.prose.layout.restored).toEqual(geometry("prose"));
    for (const [before, after] of [
      ["prose", "joined"],
      ["marker", "markerJoined"],
    ]) {
      expect(geometry(before)).toEqual(geometry(after));
      expect(reading(before)).toBe(reading(after));
      expect(records[before].rawReading).not.toBe(records[after].rawReading);
      expect(livePreview(globalThis.structuredClone(records[before].lines))).toEqual(
        livePreview(globalThis.structuredClone(records[after].lines)),
      );
    }
    // Reading's child is block-level; Live Preview's inline widget still
    // distinguishes deliberately removed visible spaces. Keep that check.
    expect(geometry("joined")).toEqual(geometry("tight"));
    expect(reading("joined")).toBe(reading("tight"));
    expect(livePreview(globalThis.structuredClone(records.joined.lines))).not.toEqual(
      livePreview(globalThis.structuredClone(records.tight.lines)),
    );
    expect(reading("joined")).not.toBe(reading("word"));
    expect(reading("joined")).not.toBe(reading("content"));
    for (const name of ["inline", "inlineTight"]) {
      expect(geometry(name).maths).toHaveLength(1);
      expect(geometry(name).maths[0].block).toBe(false);
      expect(geometry(name).maths[0].children[0].display).not.toBe("block");
    }
    const beta = (name) => {
      const found = geometry(name).words.filter(({ text }) => text === "beta");
      expect(found).toHaveLength(1);
      return found[0].rectangle;
    };
    expect(beta("inline").top).toBe(beta("inlineTight").top);
    expect(beta("inline").left).not.toBe(beta("inlineTight").left);
    expect(reading("inline")).not.toBe(reading("inlineTight"));
  });

  it("normalizes lone list paragraphs while retaining paragraph boundaries (#528)", async function () {
    if (probe || reduce) this.skip();
    const sources = [
      "- first\n- second\n",
      "- first\n\n- second\n",
      "- first\n\n  another paragraph\n",
      "- first another paragraph\n",
      '- <p class="visible-style">first</p>\n',
      "- first\n",
    ];
    const views = [];
    for (const [index, source] of sources.entries()) {
      const path = `controls/list-paragraph-${index}.md`;
      await obsidianPage.write(path, source);
      views.push(await shown(path, source));
    }
    expect(cleanHtml(views[0].reading)).toEqual(cleanHtml(views[1].reading));
    expect(cleanHtml(views[0].rawReading)).not.toEqual(cleanHtml(views[1].rawReading));
    expect(cleanHtml(views[2].reading)).not.toEqual(cleanHtml(views[3].reading));
    expect(cleanHtml(views[4].reading)).not.toEqual(cleanHtml(views[5].reading));
  });

  it("shows the documents to probe", async function () {
    if (!probe) this.skip();
    // Observe the running renderer, rather than copying a requested version
    // into a proof. executeObsidian already provides this real require bridge
    // to shown(), and the ordinary comparison reads the same apiVersion.
    const environment = await browser.executeObsidian(({ obsidian, require }) => {
      const versions = require("node:process").versions;
      return {
        obsidian: obsidian.apiVersion,
        installer: require("@electron/remote").app.getVersion(),
        chrome: versions.chrome ?? null,
        electron: versions.electron ?? null,
      };
    });
    const digest = (value) => createHash("sha256").update(value).digest("hex");
    const metadata = {
      schemaVersion: 1,
      requestedObsidian: process.env.OBSIDIAN_VERSION || baseline.app,
      requestedInstaller: process.env.OBSIDIAN_INSTALLER_VERSION || baseline.installer,
      observedObsidian: environment.obsidian,
      observedInstaller: environment.installer,
      image: JSON.parse(process.env.OBSIDIAN_IMAGE),
      browser: {
        chrome: environment.chrome,
        electron: environment.electron,
      },
      probeCount: probe.length,
      sourcePacketSha256: digest(process.env.PROBE),
      specSha256: digest(readFileSync("/check/obsidian.e2e.mjs")),
      captureSha256: null,
    };
    writeFileSync("/out/probe-metadata.json", `${JSON.stringify(metadata, null, 2)}\n`);
    const shownProbes = [];
    for (const [index, source] of probe.entries()) {
      const path = `probes/${index}.md`;
      await obsidianPage.write(path, source);
      const { reading, rawReading, preview, lines } = await shown(path, source);
      const views = {
        reading: cleanHtml(reading),
        preview: cleanHtml(preview),
        livePreview: livePreview(lines),
      };
      // The lines as read, for finding out what the comparison makes of them.
      shownProbes.push({ source, ...views, rawReading, lines });
      console.log(
        `${JSON.stringify(source)}\n  reading: ${views.reading}\n  reading view: ${views.preview}\n  live preview: ${JSON.stringify(views.livePreview)}`,
      );
    }
    writeFileSync("/out/probes.json", `${JSON.stringify(shownProbes, null, 2)}\n`);
    metadata.captureSha256 = digest(readFileSync("/out/probes.json"));
    writeFileSync("/out/probe-metadata.json", `${JSON.stringify(metadata, null, 2)}\n`);
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
        // The document keeps its end: whether a line break ends it, which `style/final-newline`
        // adds, can be what makes the difference.
        const end = named.source.endsWith("\n") ? "\n" : "";
        const join = (lines) => lines.join("\n") + end;
        const still = async (lines) =>
          (await compare(join(lines), width, workspace)).changed.includes(view);
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
        const last = await compare(join(lines), width, workspace);
        reduced.push({
          name,
          width,
          view,
          source: join(lines),
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
    await identifyHost();
    const version = report.identity.app;
    console.log(
      `Obsidian ${version}. Profile ${profile}, seeds ${seeds.join(",")}, count ${count}.`,
    );
    const workspace = createWorkspace({}, { dialect: "obsidian", strictLineBreaks: true });
    const differences = [];
    let compared = 0;
    try {
      for (const width of widths)
        for (const { name, source } of documents()) {
          const record = startDocument(report, name, width);
          const { output, views, changed, before, after } = await compare(source, width, workspace);
          record.changed = output !== source;
          const captured = record.changed ? Object.keys(views) : ["livePreview", "reading"];
          record.views = captured.map((name) => ({
            name,
            changed: record.changed,
            status: record.changed ? "compared" : "unchanged",
          }));
          record.completed = true;
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
    } finally {
      checkpoint();
    }
    const classified = classifyDifferences(
      "obsidian",
      profile,
      differences.flatMap((difference) =>
        difference.changed.map((view) => ({ ...difference, view })),
      ),
    );
    Object.assign(report, {
      obsidian: version,
      profile,
      seeds,
      count,
      widths,
      compared,
      differences,
      known: classified.known,
      unexpected: classified.unexpected,
      stale: classified.stale,
    });
    checkpoint();
    console.log(
      `Compared ${compared} formatted documents; ${differences.length} showed differently.`,
    );
    for (const { name, width, changed } of differences)
      console.log(`  ${name} at ${width} columns: ${changed.join(", ")}`);
    // Keep diagnostics visible even if bookkeeping validation rejects the report.
    validateRendererReport(report, { profile, seeds, count }, "obsidian");
    expect(compared).toBeGreaterThan(0);
    expect(
      classified.unexpected.map(({ name, width, view }) => `${name} at ${width}, ${view}`),
    ).toEqual([]);
    expect(classified.stale).toEqual([]);
  });
});
