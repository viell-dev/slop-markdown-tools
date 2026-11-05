/** Documents for GitHub's lazy HTML collector: a unit repeated `count` times after a prefix. */
export const lazyHtmlCases = [
  {
    name: "separate containers",
    prefix: "",
    unit: "- item *a*\n<b>\n*w*\n\n> quote\n</b>\n*w*\n\nText.\n\n",
    regions: (count: number) => 2 * count,
  },
  { name: "one paragraph", prefix: "- a\n", unit: "<b>\nwords *a*\n", regions: () => 1 },
  { name: "lines without tags", prefix: "- a <i>\n", unit: "words and more\n", regions: () => 0 },
  {
    name: "headings and definitions",
    prefix: "",
    unit: "- [x]: /u\n[y]: /v\n<b>\n*w*\n\n> a *w\n<i>\nx* y\n> ===\n\nText.\n\n",
    regions: (count: number) => 2 * count,
  },
  { name: "one item's definitions", prefix: "- [a]: /u\n", unit: "[b]: </v>\n", regions: () => 0 },
];
