const { spawn } = require("node:child_process");
const { assertNodeSummary } = require("./test-results.cjs");
const minimum = Number(process.argv[2]);
const files = process.argv.slice(3);
if (!Number.isInteger(minimum) || minimum < 1 || files.length === 0) {
  throw new Error(
    "Usage: node node-tests.cjs <minimum-passing-tests> <files...>",
  );
}
const child = spawn(
  process.execPath,
  ["--test", "--test-reporter=tap", ...files],
  {
    stdio: ["inherit", "pipe", "inherit"],
    timeout: 300000,
  },
);
let tail = "";
child.stdout.on("data", (chunk) => {
  process.stdout.write(chunk);
  tail = (tail + chunk.toString()).slice(-65536);
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("close", (code) => {
  try {
    if (code !== 0) throw new Error(`Node tests exited with ${code}`);
    assertNodeSummary(tail, minimum);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
});
