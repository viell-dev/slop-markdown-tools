// Format one Markdown string through the library API.
//
//   node examples/library/format-string.mjs
import { format } from "mdrefine";

const source = "A *short* note with __strong__ words and no final newline.";

// Without `config`, the recommended preset applies and the GitHub dialect is
// assumed. Pass the same object you would write in mdtools.config.jsonc to
// choose a dialect or change rules.
const result = format(source, {
  config: {
    extends: ["recommended", "github"],
    rules: { "style/wrap": ["warn", { width: 40 }] },
  },
});

// `output` is the formatted text and `changed` says whether it differs from the
// input. `diagnostics` lists what is still wrong afterwards; it is empty here.
console.log(result.output);
console.log(`changed: ${result.changed}; remaining diagnostics: ${result.diagnostics.length}`);
