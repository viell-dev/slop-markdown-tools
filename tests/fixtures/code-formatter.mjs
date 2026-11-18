import process from "node:process";
import { Buffer } from "node:buffer";
import { readFileSync, writeFileSync, existsSync, openSync, closeSync, unlinkSync } from "node:fs";
import { setTimeout, setInterval, clearInterval } from "node:timers";
import { spawn } from "node:child_process";

const [mode, filepath, record, label = "formatted"] = process.argv.slice(2);
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  const source = Buffer.concat(chunks).toString("utf8");
  const calls = existsSync(record) ? JSON.parse(readFileSync(record, "utf8")) : [];
  calls.push({ source, filepath, cwd: process.cwd(), label });
  writeFileSync(record, JSON.stringify(calls));
  if (mode === "fail") {
    process.stdout.write("partial output");
    process.stderr.write("bad input");
    process.exitCode = 7;
  } else if (mode === "invalid") process.stdout.write(Buffer.from([0xff]));
  else if (mode === "oversize") process.stdout.write("x".repeat(2048));
  else if (mode === "timeout") setInterval(() => {}, 1000);
  else if (mode === "tree") {
    // The child outlives any test that observes it, and ends only a run that
    // failed to stop it.
    const heartbeat = record + ".heartbeat";
    const child = `
      const fs = require("node:fs");
      let count = 0;
      setInterval(() => { try { fs.writeFileSync(process.argv[1], String(++count)); } catch { process.exit(0); } }, 50);
      setTimeout(() => process.exit(0), 60000);
    `;
    spawn(process.execPath, ["-e", child, heartbeat], { stdio: "ignore" });
    // Exceed a small output limit once the child runs, so the stop never
    // precedes it however slowly the processes start.
    const ready = setInterval(() => {
      if (!existsSync(heartbeat)) return;
      clearInterval(ready);
      process.stdout.write("x".repeat(2048));
    }, 20);
    setInterval(() => {}, 1000);
  }
  else if (mode === "collision") process.stdout.write("before\n```\nafter\n");
  else if (mode === "echo") process.stdout.write(source);
  else if (mode === "rewrite") {
    writeFileSync(filepath, "outside change\n");
    process.stdout.write(label + "\n");
  }
  else if (mode === "serial") {
    const lock = record + ".lock";
    const handle = openSync(lock, "wx");
    setTimeout(() => {
      closeSync(handle);
      unlinkSync(lock);
      process.stdout.write(label + "\n");
    }, 100);
  } else process.stdout.write(label + "\n");
});
