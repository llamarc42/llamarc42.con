const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const YAML = createRequire(path.resolve("packages/tool-contract/package.json"))(
  "yaml",
);
const { validatePlatformMatrix } = require("./platform-matrix.cjs");
const { verifyAsset } = require("./prepare-ripgrep.cjs");
const workflow = YAML.parse(
  fs.readFileSync(".github/workflows/fork-ci.yml", "utf8"),
);

for (const [name, mutate] of [
  [
    "floating Node runtime",
    (w) => {
      w.jobs.static.steps.find((s) =>
        s.uses?.startsWith("actions/setup-node@"),
      ).with["node-version"] = "22";
    },
  ],
  [
    "floating Python runtime",
    (w) => {
      w.jobs.static.steps.find((s) =>
        s.uses?.startsWith("actions/setup-python@"),
      ).with["python-version"] = "3.x";
    },
  ],
  [
    "no-op summary",
    (w) => {
      w.jobs.required.steps[0].with.script = "console.log('pass')";
    },
  ],
  [
    "fake summary results",
    (w) => {
      w.jobs.required.steps[0].env.JOB_RESULTS = "{}";
    },
  ],
  [
    "path-filtered PRs",
    (w) => {
      w.on.pull_request.paths = ["core/**"];
    },
  ],
  [
    "missing PR trigger",
    (w) => {
      delete w.on.pull_request;
    },
  ],
  [
    "parallel static stage",
    (w) => {
      delete w.jobs.static.needs;
    },
  ],
  [
    "parallel platform stage",
    (w) => {
      delete w.jobs.platform.needs;
    },
  ],
  [
    "write token",
    (w) => {
      w.permissions.contents = "write";
    },
  ],
  [
    "job permission override",
    (w) => {
      w.jobs.static.permissions = { contents: "write" };
    },
  ],
  [
    "install credentials",
    (w) => {
      w.jobs.static.steps.find(
        (s) => s.run === "node scripts/ci/run.mjs install",
      ).env = { GITHUB_TOKEN: "${{ github.token }}" };
    },
  ],
  [
    "credentials under alternate name",
    (w) => {
      w.env.DOWNLOAD_AUTH = "${{ secrets.AUTH }}";
    },
  ],
  [
    "wrong checkout ref",
    (w) => {
      w.jobs.platform.steps[0].with.ref = "main";
    },
  ],
  [
    "retained checkout credentials",
    (w) => {
      w.jobs.platform.steps[0].with["persist-credentials"] = true;
    },
  ],
  [
    "missing timeout",
    (w) => {
      delete w.jobs.static["timeout-minutes"];
    },
  ],
  [
    "shell ignoring failures",
    (w) => {
      w.jobs.static.steps[4].shell = "bash {0}; exit 0";
    },
  ],
  [
    "missing validator tests",
    (w) => {
      w.jobs.preflight.steps = w.jobs.preflight.steps.filter(
        (s) => !s.run?.includes("node-tests.cjs"),
      );
    },
  ],
  [
    "checks reordered",
    (w) => {
      w.jobs.platform.steps.reverse();
    },
  ],
]) {
  test(`audit rejects ${name}`, () => {
    const candidate = structuredClone(workflow);
    mutate(candidate);
    assert.throws(() => validatePlatformMatrix(candidate));
  });
}
for (const stage of ["preflight", "static", "platform"]) {
  for (const state of [
    "failure",
    "cancelled",
    "skipped",
    "pending",
    undefined,
  ]) {
    test(`actual summary rejects ${stage}: ${state}`, () => {
      const results = Object.fromEntries(
        ["preflight", "static", "platform"].map((name) => [
          name,
          { result: "success" },
        ]),
      );
      results[stage] = { result: state };
      let failed = false;
      vm.runInNewContext(
        workflow.jobs.required.steps[0].with.script,
        {
          process: { env: { JOB_RESULTS: JSON.stringify(results) } },
          core: {
            setFailed: () => {
              failed = true;
            },
          },
        },
        { timeout: 1000 },
      );
      assert.equal(failed, true);
    });
  }
}
test("ripgrep integrity check accepts pinned bytes and rejects changed bytes", () => {
  const { createHash } = require("node:crypto");
  const bytes = Buffer.from("release fixture");
  const digest = createHash("sha256").update(bytes).digest("hex");
  assert.doesNotThrow(() => verifyAsset(bytes, digest));
  assert.throws(
    () => verifyAsset(Buffer.from("changed"), digest),
    /checksum mismatch/,
  );
});
