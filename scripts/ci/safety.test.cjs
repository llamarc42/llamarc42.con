const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { validateLockfiles } = require("./lockfiles.cjs");
const { mergeReviewed } = require("./merge-reviewed.cjs");

test("lock-only edits and deletions cannot bypass manifest comparison", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "llamarc42-lock-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const manifest = { version: "1.0.0", dependencies: { ajv: "8.17.1" } };
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
  const lockPath = path.join(root, "package-lock.json");
  fs.writeFileSync(lockPath, JSON.stringify({ packages: { "": manifest } }));
  assert.doesNotThrow(() => validateLockfiles(["package-lock.json"], root));
  fs.writeFileSync(
    lockPath,
    JSON.stringify({
      packages: { "": { ...manifest, dependencies: { ajv: "0.0.0" } } },
    }),
  );
  assert.throws(
    () => validateLockfiles(["package-lock.json"], root),
    /differs/,
  );
  fs.unlinkSync(lockPath);
  assert.throws(
    () => validateLockfiles(["package-lock.json"], root),
    /missing/,
  );
  fs.unlinkSync(path.join(root, "package.json"));
  assert.doesNotThrow(() =>
    validateLockfiles(["package.json", "package-lock.json"], root),
  );
});

const sha = "a".repeat(40);
const options = {
  repo: "llamarc42/llamarc42.con",
  number: 2,
  sha,
  merge: true,
};
function fixture({
  failAt,
  stale = false,
  unresolved = false,
  ci = "success",
  changed = false,
  summary = "success",
  baseStatus = "ahead",
  reviewRunStatus = "success",
  missingJob,
  duplicateJob,
  jobFailure,
  newerFailedRun = false,
  changedBase = false,
} = {}) {
  let calls = 0;
  let merges = 0;
  const call = () => {
    calls++;
    if (calls === failAt) throw new Error("API unavailable");
  };
  const pr = {
    state: "open",
    draft: false,
    head: { sha },
    base: { ref: "main", sha: "base" },
  };
  return {
    api: {
      get: async (endpoint) => {
        call();
        if (endpoint.includes("/compare/"))
          return {
            status: baseStatus,
            behind_by: baseStatus === "ahead" ? 0 : 1,
            merge_base_commit: { sha: "base" },
          };
        if (endpoint.includes("/actions/"))
          return {
            workflow_runs: [
              ...(newerFailedRun
                ? [
                    {
                      id: 11,
                      event: "pull_request",
                      head_sha: sha,
                      status: "completed",
                      conclusion: "failure",
                    },
                  ]
                : []),
              {
                id: 9,
                event: "pull_request",
                head_sha: sha,
                status: "completed",
                conclusion: ci,
              },
            ],
          };
        if (changedBase && calls > 1)
          return { ...pr, base: { ...pr.base, sha: "new-base" } };
        return changed && calls > 1
          ? { ...pr, head: { sha: "b".repeat(40) } }
          : pr;
      },
      pages: async (endpoint, field) => {
        call();
        if (field === "workflow_runs")
          return [
            {
              id: 10,
              head_sha: sha,
              event: "dynamic",
              path: "dynamic/agents/copilot-pull-request-reviewer",
              status: "completed",
              conclusion: reviewRunStatus,
            },
          ];
        if (field === "jobs") {
          assert.match(endpoint, /runs\/9\/jobs\?filter=latest/);
          return [
            ...(duplicateJob ? [duplicateJob] : []),
            "preflight",
            "static",
            "Platform (ubuntu-24.04)",
            "Platform (windows-2022)",
            "Platform (macos-14)",
            "Fork CI required",
          ]
            .filter(
              (name) =>
                name !== missingJob &&
                !(name === "Fork CI required" && summary === "missing"),
            )
            .map((name) => ({
              name,
              status: "completed",
              conclusion:
                name === jobFailure
                  ? "failure"
                  : name === "Fork CI required"
                    ? summary
                    : "success",
            }));
        }
        return [
          {
            id: 1,
            user: { login: "copilot-pull-request-reviewer[bot]", type: "Bot" },
            commit_id: stale ? "old" : sha,
            state: "COMMENTED",
            submitted_at: "2026-09-22T18:00:00Z",
          },
        ];
      },
      unresolved: async () => {
        call();
        return unresolved;
      },
      merge: async (_endpoint, expected) => {
        merges++;
        assert.equal(expected, sha);
        return { merged: true };
      },
    },
    merges: () => merges,
  };
}
for (let failAt = 1; failAt <= 8; failAt++) {
  test(`API failure at read ${failAt} prevents merge despite any cached status`, async () => {
    const f = fixture({ failAt });
    await assert.rejects(mergeReviewed(options, f.api), /API unavailable/);
    assert.equal(f.merges(), 0);
  });
}
for (const [name, scenario] of [
  ["stale review", { stale: true }],
  ["unresolved thread", { unresolved: true }],
  ["failed CI", { ci: "failure" }],
  ["head changes", { changed: true }],
  ["skipped summary", { summary: "skipped" }],
  ["missing summary", { summary: "missing" }],
  ["failed summary", { summary: "failure" }],
  ["cancelled summary", { summary: "cancelled" }],
  ["stale base before verification", { baseStatus: "diverged" }],
  [
    "cancelled Copilot run despite submitted review",
    { reviewRunStatus: "cancelled" },
  ],
  [
    "missing platform job despite successful summary",
    { missingJob: "Platform (windows-2022)" },
  ],
  ["newer failed CI cannot use older green run", { newerFailedRun: true }],
  ["base changes during verification", { changedBase: true }],
]) {
  test(`${name} prevents merge`, async () => {
    const f = fixture(scenario);
    await assert.rejects(mergeReviewed(options, f.api));
    assert.equal(f.merges(), 0);
  });
}
for (const name of [
  "preflight",
  "static",
  "Platform (ubuntu-24.04)",
  "Platform (windows-2022)",
  "Platform (macos-14)",
  "Fork CI required",
]) {
  test(`merge requires one successful ${name}`, async () => {
    for (const scenario of [
      { missingJob: name },
      { duplicateJob: name },
      { jobFailure: name },
    ]) {
      const f = fixture(scenario);
      await assert.rejects(mergeReviewed(options, f.api));
      assert.equal(f.merges(), 0);
    }
  });
}
test("verification is read-only unless merge is explicit", async () => {
  const f = fixture();
  await mergeReviewed({ ...options, merge: false }, f.api);
  assert.equal(f.merges(), 0);
  await mergeReviewed(options, f.api);
  assert.equal(f.merges(), 1);
});
