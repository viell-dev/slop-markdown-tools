// Loaded with `--import` into a tool child that a test runs under a deadline (#827, #888).
// A tool can finish its work and print its last line long before its process ends. These
// two lines on standard error, which the tests print only on failure, show whether
// JavaScript had ended while the process was still alive.
import process from "node:process";

for (const event of ["beforeExit", "exit"]) {
  process.on(event, (code) => {
    process.stderr.write(`${new Date().toISOString()} exit-trace ${event} ${code}\n`);
  });
}
