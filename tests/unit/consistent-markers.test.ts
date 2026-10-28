import { describe, expect, it } from "vitest";
import { dialects, lint, parse, semanticFingerprint } from "../../src/index.js";
import type { Dialect } from "../../src/index.js";
import { formatted, only } from "../support/rules.js";

const rules = {
  "style/emphasis": ["warn", { marker: "consistent" }],
  "style/strong": ["warn", { marker: "consistent" }],
} as const;

function verify(source: string, expected: string, dialect: Dialect) {
  const output = formatted(source, only(rules, dialect));
  expect(output).toBe(expected);
  expect(semanticFingerprint(parse(output, dialect))).toBe(
    semanticFingerprint(parse(source, dialect)),
  );
  expect(lint(output, { config: only(rules, dialect) })).toEqual([]);
}

describe.each(dialects)("consistent markers in %s", (dialect) => {
  it.each(["\n", "\r\n"])("chooses each kind independently with %j", (eol) => {
    for (const [source, expected] of [
      [
        "*first* and _later_; __bold__ and **later**",
        "*first* and *later*; __bold__ and __later__",
      ],
      [
        "_first_ and *later*; **bold** and __later__",
        "_first_ and _later_; **bold** and **later**",
      ],
      ["*first*\n\n_later_", "*first*\n\n*later*"],
      ["**first**\n\n__later__", "**first**\n\n**later**"],
    ]) {
      verify(source!.replaceAll("\n", eol) + eol, expected!.replaceAll("\n", eol) + eol, dialect);
    }
  });

  it("counts intraword emphasis and keeps forced stars after an underscore choice", () => {
    verify("un*believ*able and _later_\n", "un*believ*able and *later*\n", dialect);
    verify(
      "_first_ and un*believ*able and *later*\n",
      "_first_ and un*believ*able and _later_\n",
      dialect,
    );
  });

  it("ignores literal markers, code and HTML", () => {
    const prefix =
      "`_code_ __code__`\n\n```md\n_hidden_ __hidden__\n```\n\n<!-- _hidden_ __hidden__ -->\n\n";
    verify(
      prefix + "*first* _later_ **first** __later__\n",
      prefix + "*first* *later* **first** **later**\n",
      dialect,
    );
    verify("plain text only\n", "plain text only\n", dialect);
  });

  it("chooses from nested nodes in opening-delimiter order", () => {
    verify(
      "**_first_** and *later* and __later__\n",
      "**_first_** and _later_ and **later**\n",
      dialect,
    );
  });

  it("keeps adjacent delimiters and reference labels protected", () => {
    const source = "_first_ **first**\n\n*__nested__* and [*label*][]\n\n[*label*]: /target\n";
    verify(source, source, dialect);
  });

  it("lets protected first reference labels choose the marker", () => {
    verify(
      "[*label*][] [__bold__][]\n\n_later_ **later**\n\n[*label*]: /one\n[__bold__]: /two\n",
      "[*label*][] [__bold__][]\n\n*later* __later__\n\n[*label*]: /one\n[__bold__]: /two\n",
      dialect,
    );
  });
});

it("does not take Obsidian's TOC-looking wikilink for emphasis (#703)", () => {
  verify(
    "[[_TOC_]] [[__TOC__]]\n\n*first* _later_ **first** __later__\n",
    "[[_TOC_]] [[__TOC__]]\n\n*first* *later* **first** **later**\n",
    "obsidian",
  );
});

it("retains actual emphasis inside brackets in CommonMark", () => {
  verify("[[_TOC_]]\n\n*later*\n", "[[_TOC_]]\n\n_later_\n", "commonmark");
});

it("keeps Obsidian stray-marker blocks while formatting other paragraphs", () => {
  verify(
    "_first_ **first**\n\nsnake_case *keep* __keep__\n\n*later* __later__\n",
    "_first_ **first**\n\nsnake_case *keep* __keep__\n\n_later_ **later**\n",
    "obsidian",
  );
});

it("keeps Gitea's .py exception", () => {
  const source = "_first_ **first**\n\n*config*.py and __init__.py\n";
  verify(source, source, "gitea");
});
