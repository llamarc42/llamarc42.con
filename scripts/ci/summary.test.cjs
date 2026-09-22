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
