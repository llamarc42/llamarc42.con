import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

export function run(command, args, cwd = process.cwd(), timeout = 1200000) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    timeout,
    // npm.cmd requires cmd.exe; all callers supply fixed, repository-owned args.
    shell: process.platform === "win32" && command === "npm.cmd",
    env: {
      ...process.env,
      CI: "true",
      HUSKY: "0",
      PUPPETEER_SKIP_DOWNLOAD: "true",
    },
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${result.error || result.status}`,
    );
  }
}

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const support = [
  "config-types",
  "terminal-security",
  "fetch",
  "config-yaml",
  "llm-info",
  "openai-adapters",
  "continue-sdk",
];
const components = ["core", "gui", "extensions/vscode"];
const task = process.argv[2];

if (task === "install") {
  for (const directory of [
    ".",
    ...support.map((p) => `packages/${p}`),
    ...components,
  ]) {
    run(npm, ["ci", "--no-audit", "--no-fund"], resolve(directory));
    if (directory.startsWith("packages/"))
      run(npm, ["run", "build"], resolve(directory));
  }
} else if (task === "static") {
  run(npm, ["run", "write-build-timestamp"], resolve("extensions/vscode"));
  for (const directory of components) {
    run(
      process.execPath,
      [resolve("node_modules/typescript/bin/tsc"), "--noEmit", "-p", "."],
      resolve(directory),
    );
  }
  run(npm, ["run", "lint"], resolve("core"));
  run(npm, ["run", "lint", "--", "src"], resolve("gui"));
  run(npm, ["run", "lint"], resolve("extensions/vscode"));
} else if (task === "tests") {
  // Explicitly excludes credential-dependent provider tests using upstream's flag.
  process.env.IGNORE_API_KEY_TESTS = "true";
  run(npm, ["test", "--", "--runInBand", "--bail"], resolve("core"));
  run(npm, ["run", "vitest", "--", "--bail=1"], resolve("core"));
  run(npm, ["test", "--", "--bail=1"], resolve("gui"));
  run(npm, ["run", "vitest", "--", "--bail=1"], resolve("extensions/vscode"));
  for (const directory of ["terminal-security", "fetch", "openai-adapters"]) {
    run(
      npm,
      ["exec", "--", "vitest", "run", "--bail=1"],
      resolve(`packages/${directory}`),
    );
  }
  run(
    npm,
    ["test", "--", "--runInBand", "--bail"],
    resolve("packages/config-yaml"),
  );
} else if (task === "package") {
  const target = `${process.platform}-${process.arch}`;
  const suffix =
    process.platform === "win32"
      ? "-msvc"
      : process.platform === "linux"
        ? "-gnu"
        : "";
  const native = `@lancedb/vectordb-${target}${suffix}`;
  const metadataPath = `extensions/vscode/node_modules/${native}/package.json`;
  const lock = JSON.parse(readFileSync("extensions/vscode/package-lock.json"));
  if (
    !existsSync(metadataPath) ||
    JSON.parse(readFileSync(metadataPath)).version !==
      lock.packages[`node_modules/${native}`]?.version
  ) {
    throw new Error(
      `Missing lockfile-matched native package: ${native}; refusing unpinned fallback`,
    );
  }
  process.env.SKIP_INSTALLS = "true";
  process.env.CONTINUE_VSCODE_TARGET = target;
  run(npm, ["run", "build"], resolve("gui"));
  run(
    npm,
    ["run", "package", "--", "--target", target],
    resolve("extensions/vscode"),
  );
  if (
    !readdirSync("extensions/vscode/build").some((file) =>
      file.endsWith(".vsix"),
    )
  ) {
    throw new Error("Package command produced no VSIX");
  }
} else {
  throw new Error(`Unknown CI task: ${task}`);
}
