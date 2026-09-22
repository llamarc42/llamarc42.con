const assert = require("node:assert/strict");

function validatePlatformMatrix(workflow) {
  const platform = workflow.jobs?.platform;
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
    [].concat(workflow.jobs?.required?.needs || []).includes("platform"),
    "Required summary must depend on the platform matrix",
  );
}

module.exports = { validatePlatformMatrix };
