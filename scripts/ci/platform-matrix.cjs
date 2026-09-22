const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const summaryScript = [
  "const results = JSON.parse(process.env.JOB_RESULTS);",
  "for (const job of ['preflight', 'static', 'platform']) {",
  "  if (results[job]?.result !== 'success') core.setFailed(`${job} did not pass`);",
  "}",
].join("\n");
const testCommand =
  "node scripts/ci/node-tests.cjs 64 scripts/ci/review-policy.test.cjs scripts/ci/summary.test.cjs scripts/ci/safety.test.cjs scripts/ci/audit.test.cjs";
const uploadAction =
  "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02";

function validateRequiredWorkflow(root, parse) {
  // Read the fixed contract directly: a rename/deletion must fail, not silently
  // evade validation while other workflows are enumerated.
  const workflow = parse(
    readFileSync(resolve(root, ".github/workflows/fork-ci.yml"), "utf8"),
  );
  validatePlatformMatrix(workflow);
}

const smokeConditions = new Map([
  ["xvfb-run -a node scripts/ci/extension-smoke.cjs", "runner.os == 'Linux'"],
  ["node scripts/ci/extension-smoke.cjs", "runner.os != 'Linux'"],
]);
const requiredCommands = {
  preflight: [
    "npm ci --ignore-scripts --no-audit --no-fund",
    "npm ci --prefix packages/tool-contract --no-audit --no-fund",
    "node scripts/ci/preflight.mjs",
    "go run github.com/rhysd/actionlint/cmd/actionlint@v1.7.7 -shellcheck= -pyflakes= .github/workflows/fork-ci.yml .github/workflows/copilot-review-gate.yml .github/workflows/review-metadata-changed.yml",
    "npm test --prefix packages/tool-contract",
    testCommand,
  ],
  static: [
    "node scripts/ci/prepare-ripgrep.cjs",
    "node scripts/ci/run.mjs install",
    "node scripts/ci/run.mjs static",
  ],
  platform: [
    "npm ci --prefix packages/tool-contract --no-audit --no-fund",
    "npm test --prefix packages/tool-contract",
    "node scripts/ci/prepare-ripgrep.cjs",
    "node scripts/ci/run.mjs install",
    "node scripts/ci/run.mjs tests",
    "node scripts/ci/run.mjs package",
    "npm ci --prefix scripts/ci --no-audit --no-fund",
    ...smokeConditions.keys(),
  ],
};

function validatePlatformMatrix(workflow) {
  assert.deepEqual(
    workflow.on,
    { pull_request: { branches: ["main"] }, workflow_dispatch: null },
    "PR validation must run without event/path filters",
  );
  assert.deepEqual(
    workflow.permissions,
    { contents: "read" },
    "PR workflow must be read-only",
  );
  assert.equal(workflow.defaults, undefined, "No workflow shell/cwd overrides");
  assert.equal(
    workflow.concurrency?.["cancel-in-progress"],
    true,
    "Obsolete runs must cancel",
  );
  assert.equal(
    workflow.jobs.preflight?.needs,
    undefined,
    "Preflight must run first",
  );
  assert.equal(
    workflow.jobs.static?.needs,
    "preflight",
    "Static must depend on preflight",
  );
  assert.equal(
    workflow.jobs.platform?.needs,
    "static",
    "Platform must depend on static",
  );
  for (const job of Object.values(workflow.jobs)) {
    assert.equal(job.permissions, undefined, "No job permission escalation");
    assert.equal(job.defaults, undefined, "No job shell/cwd overrides");
    assert.ok(
      Number.isInteger(job["timeout-minutes"]) &&
        job["timeout-minutes"] > 0 &&
        job["timeout-minutes"] <= 60,
      "Jobs need bounded timeouts",
    );
    for (const step of job.steps || []) {
      assert.equal(step.shell, undefined, "No custom shell wrappers");
      assert.equal(
        step["working-directory"],
        undefined,
        "Commands must use repository root",
      );
      if (step.uses)
        assert.match(
          step.uses,
          /^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/,
          "Actions must be SHA pinned",
        );
      if (step.uses?.startsWith("actions/setup-node@"))
        assert.match(
          step.with?.["node-version"] || "",
          /^\d+\.\d+\.\d+$/,
          "Node runtime must be pinned to an exact version",
        );
      if (step.uses?.startsWith("actions/setup-python@"))
        assert.match(
          step.with?.["python-version"] || "",
          /^\d+\.\d+\.\d+$/,
          "Python runtime must be pinned to an exact version",
        );
      if (step.uses?.startsWith("actions/checkout@")) {
        assert.equal(
          step.with?.ref,
          undefined,
          "Validate the PR merge checkout, not a substituted ref",
        );
        assert.equal(
          step.with?.["persist-credentials"],
          false,
          "Checkout cannot retain credentials",
        );
      }
    }
  }
  // No credential injection through PR command environments.
  for (const env of [
    workflow.env,
    ...Object.values(workflow.jobs).flatMap((job) => [
      job.env,
      ...job.steps.map((step) => step.env),
    ]),
  ]) {
    for (const [key, value] of Object.entries(env || {})) {
      assert.ok(
        !/TOKEN|SECRET|PASSWORD/i.test(key) &&
          !/github\.token|secrets\s*[.[]/i.test(String(value)),
        "Credentials cannot enter PR command environments",
      );
    }
  }
  for (const name of ["preflight", "static", "platform"]) {
    const job = workflow.jobs?.[name];
    assert.ok(job && Array.isArray(job.steps), `Missing ${name} stage steps`);
    assert.ok(job.steps.length > 0, `${name} stage cannot be empty`);
    assert.equal(job.if, undefined, `${name} stage cannot be conditional`);
    for (const step of job.steps) {
      const allowedCondition =
        name === "platform" &&
        step.name === "Preserve test reports" &&
        step.uses === uploadAction
          ? "always()"
          : name === "platform"
            ? smokeConditions.get(step.run)
            : undefined;
      assert.equal(
        step.if,
        allowedCondition,
        `${name} step has an unsupported condition`,
      );
    }
    for (const command of requiredCommands[name]) {
      assert.equal(
        job.steps.filter((step) => step.run === command).length,
        1,
        `${name} must run ${command} exactly once`,
      );
    }
    const indices = requiredCommands[name].map((command) =>
      job.steps.findIndex((step) => step.run === command),
    );
    assert.ok(
      indices.every(
        (value, index) => index === 0 || value > indices[index - 1],
      ),
      `${name} checks must run in required order`,
    );
    for (const [label, item] of [
      [name, job],
      ...job.steps.map((step, index) => [`${name} step ${index + 1}`, step]),
    ]) {
      assert.ok(
        item["continue-on-error"] === undefined ||
          item["continue-on-error"] === false,
        `${label} failures cannot be ignored`,
      );
    }
  }
  const platform = workflow.jobs?.platform;
  assert.equal(
    platform.strategy?.["fail-fast"],
    true,
    "Platform matrix must explicitly fail fast",
  );
  const matrix = platform?.strategy?.matrix;
  assert.ok(matrix && typeof matrix === "object", "Missing platform matrix");
  // Reject extra axes and include/exclude rules: they can change the expanded
  // job inventory even when the os list itself looks correct.
  assert.deepEqual(
    Object.keys(matrix),
    ["os"],
    "Only the fixed OS axis is supported",
  );
  assert.ok(Array.isArray(matrix.os), "OS matrix must be a literal array");
  assert.deepEqual(
    [...matrix.os].sort(),
    ["macos-14", "ubuntu-24.04", "windows-2022"],
    "Each required OS must appear exactly once",
  );
  assert.equal(
    platform["runs-on"],
    "${{ matrix.os }}",
    "Runner must use the OS matrix",
  );
  const summary = workflow.jobs?.required;
  assert.equal(summary?.if, "always()", "Required summary must always run");
  assert.ok(
    summary["continue-on-error"] === undefined ||
      summary["continue-on-error"] === false,
    "Summary failures cannot be ignored",
  );
  assert.deepEqual(
    [...summary.needs].sort(),
    ["platform", "preflight", "static"],
    "Summary must depend on every stage",
  );
  assert.equal(summary.steps?.length, 1, "Expected one required summary step");
  const step = summary.steps[0];
  assert.equal(step.if, undefined, "Summary step cannot be conditional");
  assert.ok(
    step["continue-on-error"] === undefined ||
      step["continue-on-error"] === false,
    "Summary step failures cannot be ignored",
  );
  assert.equal(
    step.uses,
    "actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b",
    "Summary must execute the pinned checker action",
  );
  assert.equal(
    step.with?.script?.trim(),
    summaryScript,
    "Required summary checker must match the reviewed fail-closed implementation",
  );
  assert.deepEqual(
    step.env,
    { JOB_RESULTS: "${{ toJSON(needs) }}" },
    "Summary must consume actual dependency results",
  );
}

module.exports = {
  validatePlatformMatrix,
  validateRequiredWorkflow,
  summaryScript,
};
