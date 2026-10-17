// Write config.schema.json, the configuration's JSON Schema that the package
// ships and the documentation site serves, from the schema that the tool
// enforces. A test fails when the two differ.
//
//   npm run schema
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { format, resolveConfig } from "prettier";
import { configSchema } from "../dist/index.js";

const file = path.join(import.meta.dirname, "..", "config.schema.json");
const options = { ...(await resolveConfig(file)), filepath: file };
await writeFile(file, await format(JSON.stringify(configSchema), options));
