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
const {
  validatePlatformMatrix,
  validateRequiredWorkflow,
} = require("./platform-matrix.cjs");

test("required workflow cannot be missing or renamed", (t) => {
  const root = fs.mkdtempSync(
    path.join(require("node:os").tmpdir(), "llamarc42-workflow-"),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = path.join(root, ".github/workflows");
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "fork-ci.yml");
  const validate = () =>
    validateRequiredWorkflow(root, (source) => YAML.parse(source));
  assert.throws(validate, /ENOENT/);
  fs.writeFileSync(file, YAML.stringify(workflow));
  assert.doesNotThrow(validate);
  fs.renameSync(file, path.join(directory, "renamed.yml"));
  assert.throws(validate, /ENOENT/);
});

for (const name of ["preflight", "static", "platform"]) {
  test(`${name} rejects empty stages and conditional steps`, () => {
    const empty = structuredClone(workflow);
    empty.jobs[name].steps = [];
    assert.throws(() => validatePlatformMatrix(empty), /cannot be empty/);
    for (let index = 0; index < workflow.jobs[name].steps.length; index++) {
      for (const condition of [false, "false", "${{ false }}", "success()"]) {
        const candidate = structuredClone(workflow);
        candidate.jobs[name].steps[index].if = condition;
        assert.throws(
          () => validatePlatformMatrix(candidate),
          /unsupported condition/,
        );
      }
    }
  });
}

test("required lint, test, packaging and smoke commands cannot be removed", () => {
  for (const [stage, command] of [
    ["preflight", "node scripts/ci/preflight.mjs"],
    ["static", "node scripts/ci/run.mjs static"],
    ["platform", "node scripts/ci/run.mjs tests"],
    ["platform", "node scripts/ci/run.mjs package"],
    ["platform", "xvfb-run -a node scripts/ci/extension-smoke.cjs"],
    ["platform", "node scripts/ci/extension-smoke.cjs"],
  ]) {
    const candidate = structuredClone(workflow);
    candidate.jobs[stage].steps = candidate.jobs[stage].steps.filter(
      (step) => step.run !== command,
    );
    assert.throws(() => validatePlatformMatrix(candidate), /exactly once/);
  }
});

test("actual workflow requires exactly the three supported platforms", () => {
  assert.doesNotThrow(() => validatePlatformMatrix(workflow));
});

test("platform matrix requires literal fail-fast true", () => {
  for (const value of [false, undefined, "${{ true }}"]) {
    const candidate = structuredClone(workflow);
    candidate.jobs.platform.strategy["fail-fast"] = value;
    assert.throws(
      () => validatePlatformMatrix(candidate),
      /must explicitly fail fast/,
    );
  }
});

for (const name of ["preflight", "static", "platform"]) {
  test(`${name} rejects ignored job failures`, () => {
    for (const value of [true, "${{ true }}"]) {
      const candidate = structuredClone(workflow);
      candidate.jobs[name]["continue-on-error"] = value;
      assert.throws(
        () => validatePlatformMatrix(candidate),
        /failures cannot be ignored/,
      );
    }
  });
  test(`${name} rejects ignored failures at every step`, () => {
    for (let index = 0; index < workflow.jobs[name].steps.length; index++) {
      for (const value of [true, "${{ true }}"]) {
        const candidate = structuredClone(workflow);
        candidate.jobs[name].steps[index]["continue-on-error"] = value;
        assert.throws(
          () => validatePlatformMatrix(candidate),
          /failures cannot be ignored/,
        );
      }
    }
  });
}

for (const [name, mutate] of [
  [
    "ignored platform failure",
    (w) => {
      w.jobs.platform["continue-on-error"] = true;
    },
  ],
  [
    "dynamic ignored platform failure",
    (w) => {
      w.jobs.platform["continue-on-error"] = "${{ true }}";
    },
  ],
  [
    "skipped summary job",
    (w) => {
      w.jobs.required.if = false;
    },
  ],
  [
    "success-only summary",
    (w) => {
      delete w.jobs.required.if;
    },
  ],
  [
    "ignored summary failure",
    (w) => {
      w.jobs.required["continue-on-error"] = true;
    },
  ],
  [
    "skipped summary step",
    (w) => {
      w.jobs.required.steps[0].if = false;
    },
  ],
  [
    "ignored summary step failure",
    (w) => {
      w.jobs.required.steps[0]["continue-on-error"] = true;
    },
  ],
  [
    "missing summary step",
    (w) => {
      w.jobs.required.steps = [];
    },
  ],
]) {
  test(`gate structure rejects ${name}`, () => {
    const candidate = structuredClone(workflow);
    mutate(candidate);
    assert.throws(() => validatePlatformMatrix(candidate));
  });
}

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
  assert.ok(gate.on.workflow_run.workflows.includes("Fork CI"));
  assert.ok(gate.on.workflow_run.types.includes("completed"));
  assert.ok(Object.hasOwn(gate.on, "workflow_dispatch"));
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
