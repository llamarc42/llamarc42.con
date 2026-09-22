const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

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
    "node scripts/ci/preflight.mjs",
    "npm test --prefix packages/tool-contract",
  ],
  static: ["node scripts/ci/run.mjs install", "node scripts/ci/run.mjs static"],
  platform: [
    "npm test --prefix packages/tool-contract",
    "node scripts/ci/run.mjs install",
    "node scripts/ci/run.mjs tests",
    "node scripts/ci/run.mjs package",
    ...smokeConditions.keys(),
  ],
};

function validatePlatformMatrix(workflow) {
  for (const name of ["preflight", "static", "platform"]) {
    const job = workflow.jobs?.[name];
    assert.ok(job && Array.isArray(job.steps), `Missing ${name} stage steps`);
    assert.ok(job.steps.length > 0, `${name} stage cannot be empty`);
    assert.equal(job.if, undefined, `${name} stage cannot be conditional`);
    for (const step of job.steps) {
      const allowedCondition =
        name === "platform" ? smokeConditions.get(step.run) : undefined;
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
  assert.equal(
    platform.if,
    undefined,
    "Platform validation cannot be conditional",
  );
  assert.ok(
    platform["continue-on-error"] === undefined ||
      platform["continue-on-error"] === false,
    "Platform failures cannot be ignored",
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
  assert.ok(
    typeof step.with?.script === "string" && step.with.script.trim(),
    "Missing summary script",
  );
  assert.ok(
    [].concat(workflow.jobs?.required?.needs || []).includes("platform"),
    "Required summary must depend on the platform matrix",
  );
}

module.exports = { validatePlatformMatrix, validateRequiredWorkflow };
