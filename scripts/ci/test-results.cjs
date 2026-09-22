function assertTestReport(report) {
  if (
    report?.success !== true ||
    !Number.isInteger(report.numTotalTests) ||
    report.numTotalTests < 1 ||
    !Number.isInteger(report.numPassedTests) ||
    report.numPassedTests < 1 ||
    report.numFailedTests !== 0
  ) {
    throw new Error("Test task must report a non-empty, successful test run");
  }
}

function assertNodeSummary(output, minimum) {
  const counts = {};
  for (const match of output.matchAll(/^# (tests|pass|fail) (\d+)\s*$/gm)) {
    counts[match[1]] = Number(match[2]);
  }
  if (
    !Number.isInteger(minimum) ||
    minimum < 1 ||
    !(counts.tests >= minimum) ||
    !(counts.pass >= minimum) ||
    counts.fail !== 0
  ) {
    throw new Error(`Node test task must pass at least ${minimum} tests`);
  }
}

module.exports = { assertTestReport, assertNodeSummary };
