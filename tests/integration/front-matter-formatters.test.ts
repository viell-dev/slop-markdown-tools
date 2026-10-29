import path from "node:path";
import { expect, it } from "vitest";
import { formatWithCode } from "../../src/node.js";
import { repository } from "../support/cli.js";
import { setup } from "../support/code-format.js";

it("runs the installed Prettier YAML printer through the Node host", async () => {
  const { root, config, tool } = await setup();
  const options = {
    cwd: root,
    config: config([
      tool({
        languages: [],
        frontMatter: ["yaml"],
        command: process.execPath,
        args: [path.join(repository, "node_modules/prettier/bin/prettier.cjs"), "--parser", "yaml"],
      }),
    ]),
  };
  const source =
    "---\r\n# preserved comment\r\ntitle:    x\r\ntags: [a,b]\r\n---\r\n\r\nA *word*.\r\n";
  const result = await formatWithCode(source, options);
  expect(result.diagnostics).toEqual([]);
  expect(result.output).toBe(source.replace("title:    x", "title: x").replace("[a,b]", "[a, b]"));
  expect((await formatWithCode(result.output, options)).changed).toBe(false);
});
it.each(["fail", "invalid", "oversize"])(
  "retains metadata after an actual %s command result",
  async (mode) => {
    const { root, config, tool } = await setup(mode);
    const source = "---\ntitle: x\n---\n\nText.\n";
    const result = await formatWithCode(source, {
      cwd: root,
      config: config([tool({ languages: [], frontMatter: ["yaml"], maxOutputBytes: 1024 })]),
    });
    expect(result.output).toBe(source);
    expect(result.diagnostics[0]?.rule).toBe("engine/code-formatter");
  },
);
