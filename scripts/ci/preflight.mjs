import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { parseManifest } from "../../packages/tool-contract/src/index.js";
import lockfiles from "./lockfiles.cjs";

const require = createRequire(
  new URL("../../packages/tool-contract/package.json", import.meta.url),
);
const YAML = require("yaml");
const base = process.env.CI_BASE_SHA;
if (!base || !/^[a-f0-9]{40}$/.test(base))
  throw new Error("CI_BASE_SHA must be a full commit SHA");
const changed = execFileSync(
  "git",
  ["diff", "--name-only", "--diff-filter=ACMR", "-z", `${base}...HEAD`],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const allChanged = execFileSync(
  "git",
  ["diff", "--name-only", "-z", `${base}...HEAD`],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
if (
  allChanged.some((path) =>
    /^(extensions\/(cli|intellij)\/|binary\/|sync\/)/.test(path),
  )
) {
  throw new Error(
    "This PR changes a surface without a validated fork CI lane; add its checks before merging",
  );
}
const formatFiles = changed.filter(
  (path) =>
    /\.(cjs|js|mjs|jsx|ts|tsx|json|css|md|ya?ml)$/.test(path) &&
    !path.startsWith(".github/upstream-workflows/"),
);
if (formatFiles.length) {
  execFileSync(
    process.execPath,
    [
      require.resolve("prettier/bin/prettier.cjs"),
      "--check",
      ...formatFiles.map((path) => resolve(path)),
    ],
    { stdio: "inherit" },
  );
}
for (const file of readdirSync(".github/workflows").filter((file) =>
  /\.ya?ml$/.test(file),
)) {
  const doc = YAML.parseDocument(
    readFileSync(`.github/workflows/${file}`, "utf8"),
    { uniqueKeys: true },
  );
  if (doc.errors.length) throw new Error(`${file}: ${doc.errors.join("; ")}`);
  const workflow = doc.toJS();
  if (!workflow.on || !workflow.jobs)
    throw new Error(`${file}: missing workflow triggers/jobs`);
}
for (const file of readdirSync("packages/tool-contract/fixtures")) {
  parseManifest(
    readFileSync(`packages/tool-contract/fixtures/${file}`, "utf8"),
  );
}
lockfiles.validateLockfiles(allChanged);
console.log(`Preflight passed for ${allChanged.length} changed paths`);
