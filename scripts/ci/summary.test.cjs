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
