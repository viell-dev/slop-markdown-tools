// Deterministic synthetic documents for the benchmarks. The same count and
// seed always produce the same bytes, so runs are comparable across machines
// and versions. Nothing here is copied from real documents.

const words =
  "garden station signal harbor window ledger pattern river method anchor basket candle delta engine fabric glacier hollow island journal kettle lantern meadow needle orchard pebble quarry ribbon saddle timber valley walnut yonder zephyr amber birch cedar dune ember fern grove heath iris juniper".split(
    " ",
  );

/** A small seeded generator (mulberry32); returns numbers in [0, 1). */
function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
function writer(seed) {
  const next = random(seed);
  const pick = (list) => list[Math.floor(next() * list.length)];
  const word = () => pick(words);
  /** A sentence whose inline markup needs the default style rules. */
  const sentence = (decorate = true) => {
    const length = 9 + Math.floor(next() * 9);
    const parts = Array.from({ length }, (_, index) => {
      const value = word();
      if (!decorate || index === 0) return value;
      const roll = next();
      if (roll < 0.06) return `*${value}*`;
      if (roll < 0.1) return `__${value}__`;
      if (roll < 0.14) return `\`${value}\``;
      return value;
    });
    const text = parts.join(" ");
    return text[0].toUpperCase() + text.slice(1) + ".";
  };
  const sentences = (count, decorate) =>
    Array.from({ length: count }, () => sentence(decorate)).join(" ");
  return { next, pick, word, sentence, sentences };
}

const repositoryPath = (index) => `docs/area-${Math.floor(index / 25)}/page-${index}.md`;
function repositoryLink(from, to) {
  const sameArea = Math.floor(from / 25) === Math.floor(to / 25);
  return sameArea ? `page-${to}.md` : `../area-${Math.floor(to / 25)}/page-${to}.md`;
}
function repositoryPage(index, count, seed) {
  const { next, word, sentence, sentences } = writer(seed * 100003 + index);
  const other = (step) => (index + 1 + Math.floor(next() * step)) % count;
  const rows = Array.from(
    { length: 4 },
    () => `| ${word()} ${word()} | ${Math.floor(next() * 900)} | ${sentence(false)} |`,
  );
  return [
    `# Page ${index}: ${word()} ${word()}`,
    "",
    `${sentences(3)} See [the setup of another page](${repositoryLink(index, other(40))}#setup) for the details.`,
    "",
    "> [!note]",
    `> ${sentence(false)}`,
    "",
    "## Setup",
    "",
    sentences(4),
    "",
    `- ${sentences(2)}`,
    `- ${sentence()}`,
    `- [X] ${sentence(false)}`,
    "",
    "| Name | Value | Notes |",
    "|---|---|---|",
    ...rows,
    "",
    "## Reference notes",
    "",
    sentences(3),
    "",
    "```js",
    `const ${word()} = measure(${index}); // Code is never reformatted, whatever its width is in the source.`,
    "```",
    "",
    `1. ${sentences(2)}`,
    `2. ${sentence()}`,
    "",
    `${sentences(2)} Continue with [the reference notes](${repositoryLink(index, other(7))}#reference-notes).`,
    "",
  ].join("\n");
}
/** Documentation of a repository on GitHub: `count` pages that link to each other. */
export function repositoryDocs(count, seed = 1) {
  const files = { "README.md": "# Project\n\nStart with *[page 0](docs/area-0/page-0.md)*.\n" };
  for (let index = 0; index < count; index++)
    files[repositoryPath(index)] = repositoryPage(index, count, seed);
  return {
    name: "repository documentation",
    files,
    config: { extends: ["recommended", "github"] },
    workspace: { dialect: "github" },
  };
}

const notePath = (index) => `Notes/Topic ${Math.floor(index / 40)}/Note ${index}.md`;
function vaultNote(index, count, seed) {
  const { next, sentence, sentences } = writer(seed * 200003 + index);
  const other = () => (index + 1 + Math.floor(next() * 60)) % count;
  return [
    `# Note ${index}`,
    "",
    `${sentences(2)} It continues in [[Note ${other()}]] and in [[Note ${other()}#Details|the details of another note]].`,
    "",
    "> [!TIP] A callout title that stays on its own line",
    `> ${sentences(2, false)}`,
    "",
    sentences(3),
    "",
    `- [X] ${sentence(false)}`,
    `- ${sentence()}`,
    "",
    "## Details",
    "",
    `${sentences(2)} ^block-${index}`,
    "",
    `![[Note ${other()}#Details]]`,
    "",
  ].join("\n");
}
/** An Obsidian vault: `count` notes joined by wikilinks, embeds, and block references. */
export function vault(count, seed = 1) {
  const files = {};
  for (let index = 0; index < count; index++)
    files[notePath(index)] = vaultNote(index, count, seed);
  return {
    name: "Obsidian vault",
    files,
    config: { extends: ["recommended", "obsidian"] },
    workspace: { dialect: "obsidian", strictLineBreaks: true },
    // On disk, the CLI reads the reflow setting from the vault's own settings file.
    extraFiles: { ".obsidian/app.json": '{ "strictLineBreaks": true }\n' },
  };
}

/** One GitHub document of roughly `bytes` bytes, built from independent sections. */
export function longDocument(bytes, seed = 1) {
  const { sentences, sentence, word } = writer(seed * 300007);
  let source = "# A long document\n";
  for (let section = 0; source.length < bytes; section++)
    source += [
      "",
      `## Section ${section}`,
      "",
      sentences(5),
      "",
      `- ${sentences(2)}`,
      `- ${sentence()}`,
      "",
      "| Name | Value |",
      "|---|---|",
      `| ${word()} | ${sentence(false)} |`,
      "",
      sentences(4),
      "",
    ].join("\n");
  return source;
}
