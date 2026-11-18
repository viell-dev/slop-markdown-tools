// Loaded with `node --import`: every taskkill that the code tools start becomes
// a stand-in that never exits and keeps its pipes open, as a stalled one would.
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import process from "node:process";

const execFile = childProcess.execFile;
childProcess.execFile = (file, args, options, callback) =>
  path.basename(String(file)).toLowerCase() === "taskkill.exe"
    ? execFile(process.execPath, ["-e", "setInterval(() => {}, 1000)"], options, callback)
    : execFile(file, args, options, callback);
syncBuiltinESMExports();
