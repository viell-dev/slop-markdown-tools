#!/usr/bin/env node
// Deprecated compatibility entry; removed with the other mdtools forms in 0.5.0.
import { warnLegacyNames } from "./deprecations.js";

warnLegacyNames();
await import("./main.js");
