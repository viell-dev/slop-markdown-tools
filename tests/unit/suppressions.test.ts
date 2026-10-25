import { describe, expect, it } from "vitest";
import { lint } from "../../src/index.js";
import { only, formatted } from "../support/rules.js";
describe("suppression directives at the end of a document", () => {
  const config = only({ "style/emphasis": "warn" });
  it("suppresses a final line without a trailing newline", () => {
    expect(formatted("<!-- mdrefine-disable-next-line style/emphasis -->\n*keep*", config)).toBe(
      "<!-- mdrefine-disable-next-line style/emphasis -->\n*keep*",
    );
  });
  it("ignores a next-line directive that has no next line", () => {
    expect(formatted("*change*\n<!-- mdrefine-disable-next-line style/emphasis -->", config)).toBe(
      "_change_\n<!-- mdrefine-disable-next-line style/emphasis -->",
    );
  });
});

describe("next-line suppression with each line ending", () => {
  const config = only({ "style/emphasis": "warn" });
  const directive = "<!-- mdrefine-disable-next-line style/emphasis -->";
  it.each([
    ["LF", "\n"],
    ["CRLF", "\r\n"],
    ["CR", "\r"],
  ])("suppresses exactly the next line with %s", (_, newline) => {
    const source = [directive, "*keep*", "*change*", ""].join(newline);
    expect(formatted(source, config)).toBe(source.replace("*change*", "_change_"));
    const at = source.indexOf("*change*");
    expect(lint(source, { config }).map((item) => item.start)).toEqual([at, at + 7]);
    // The directive's own line ending, and the last line without one.
    const last = [directive, "*keep*"].join(newline);
    expect(formatted(last, config)).toBe(last);
    expect(formatted(`*change*${newline}${directive}`, config)).toBe(
      `_change_${newline}${directive}`,
    );
  });
  it.each([
    `${directive}\r\n*keep*\r*change*\n`,
    `${directive}\r*keep*\n*change*\r\n`,
    `${directive}\n*keep*\r\n*change*\r`,
    `${directive}\r\r*change*\n`,
  ])("suppresses one line when line endings are mixed (%j)", (source) => {
    expect(formatted(source, config)).toBe(source.replace("*change*", "_change_"));
  });
});
