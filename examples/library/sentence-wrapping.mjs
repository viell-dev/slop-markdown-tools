// Keep source diffs local to a sentence, wrapping long sentences to the width.
//
//   node examples/library/sentence-wrapping.mjs
import { format } from "mdrefine";

const source =
  "The service records each request. Operators can inspect the log. Retries use the same identifier.\n";
const result = format(source, {
  config: {
    extends: ["recommended", "github"],
    rules: { "style/wrap": ["warn", { mode: "sentences", width: 80 }] },
  },
});
process.stdout.write(result.output);
