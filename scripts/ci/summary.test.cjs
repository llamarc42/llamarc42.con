const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const path = require("node:path");
const contractRequire = createRequire(
  path.resolve("packages/tool-contract/package.json"),
);
const YAML = contractRequire("yaml");
const workflow = YAML.parse(
  fs.readFileSync(".github/workflows/fork-ci.yml", "utf8"),
);
const script = workflow.jobs.required.steps[0].with.script;
const { assertTestReport, assertNodeSummary } = require("./test-results.cjs");
const { validatePlatformMatrix } = require("./platform-matrix.cjs");

test("actual workflow requires exactly the three supported platforms", () => {
  assert.doesNotThrow(() => validatePlatformMatrix(workflow));
});

for (const [name, mutate] of [
  ["missing OS", (w) => w.jobs.platform.strategy.matrix.os.pop()],
  ["duplicate OS", (w) => w.jobs.platform.strategy.matrix.os.push("macos-14")],
  [
    "replaced OS",
    (w) => {
      w.jobs.platform.strategy.matrix.os[0] = "macos-14";
    },
  ],
  [
    "excluded OS",
    (w) => {
      w.jobs.platform.strategy.matrix.exclude = [{ os: "windows-2022" }];
    },
  ],
  [
    "included job",
    (w) => {
      w.jobs.platform.strategy.matrix.include = [{ os: "macos-14" }];
    },
  ],
  [
    "dynamic matrix",
    (w) => {
      w.jobs.platform.strategy.matrix =
        "${{ fromJSON(needs.setup.outputs.matrix) }}";
    },
  ],
  [
    "fixed runner",
    (w) => {
      w.jobs.platform["runs-on"] = "ubuntu-24.04";
    },
  ],
  [
    "conditional platform",
    (w) => {
      w.jobs.platform.if = "false";
    },
  ],
  [
    "missing summary dependency",
    (w) => {
      w.jobs.required.needs = ["preflight", "static"];
    },
  ],
]) {
  test(`platform inventory rejects ${name}`, () => {
    const candidate = structuredClone(workflow);
    mutate(candidate);
    assert.throws(() => validatePlatformMatrix(candidate));
  });
}

test("test reports reject empty, skipped-only, failed, or missing inventories", () => {
  for (const report of [
    undefined,
    {},
    { success: true, numTotalTests: 0, numPassedTests: 0, numFailedTests: 0 },
    { success: true, numTotalTests: 8, numPassedTests: 0, numFailedTests: 0 },
    { success: false, numTotalTests: 8, numPassedTests: 7, numFailedTests: 1 },
  ])
    assert.throws(() => assertTestReport(report));
  assert.doesNotThrow(() =>
    assertTestReport({
      success: true,
      numTotalTests: 8,
      numPassedTests: 8,
      numFailedTests: 0,
    }),
  );
});

test("Node inventory rejects empty files and missing or skipped tests", () => {
  for (const output of [
    "",
    "# tests 0\n# pass 0\n# fail 0\n",
    "# tests 1\n# pass 1\n# fail 0\n",
    "# tests 17\n# pass 0\n# fail 0\n",
  ]) {
    assert.throws(() => assertNodeSummary(output, 17));
  }
  assert.doesNotThrow(() =>
    assertNodeSummary("# tests 17\n# pass 17\n# fail 0\n", 17),
  );
});

test("review changes relay to trusted metadata code without credentials", () => {
  const relay = YAML.parse(
    fs.readFileSync(".github/workflows/review-metadata-changed.yml", "utf8"),
  );
  const gate = YAML.parse(
    fs.readFileSync(".github/workflows/copilot-review-gate.yml", "utf8"),
  );
  assert.deepEqual(relay.permissions, {});
  assert.ok(relay.on.pull_request_review.types.includes("dismissed"));
  assert.ok(relay.on.pull_request_review.types.includes("submitted"));
  assert.ok(gate.on.workflow_run.workflows.includes(relay.name));
  assert.ok(gate.on.workflow_run.types.includes("completed"));
  assert.equal(gate.on.pull_request_review, undefined);
  assert.equal(
    gate.jobs.review.steps[0].with.ref,
    "${{ github.event.repository.default_branch }}",
  );
});

for (const status of ["failure", "cancelled", "skipped", undefined]) {
  test(`summary fails closed on ${status}`, () => {
    let failed = false;
    const results = {
      preflight: { result: "success" },
      static: { result: "success" },
      platform: { result: status },
    };
    vm.runInNewContext(script, {
      process: { env: { JOB_RESULTS: JSON.stringify(results) } },
      core: {
        setFailed: () => {
          failed = true;
        },
      },
    });
    assert.equal(failed, true);
  });
}
test("summary accepts all expected successes", () => {
  vm.runInNewContext(script, {
    process: {
      env: {
        JOB_RESULTS: JSON.stringify(
          Object.fromEntries(
            ["preflight", "static", "platform"].map((name) => [
              name,
              { result: "success" },
            ]),
          ),
        ),
      },
    },
    core: { setFailed: (message) => assert.fail(message) },
  });
});
