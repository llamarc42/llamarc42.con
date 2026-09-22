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
        if (endpoint.includes("/actions/"))
          return {
            workflow_runs: [
              {
                id: 9,
                event: "pull_request",
                head_sha: sha,
                status: "completed",
                conclusion: ci,
              },
            ],
          };
        return changed && calls > 1
          ? { ...pr, head: { sha: "b".repeat(40) } }
          : pr;
      },
      pages: async (endpoint, field) => {
        call();
        if (field === "jobs") {
          assert.match(endpoint, /runs\/9\/jobs\?filter=latest/);
          return summary === "missing"
            ? []
            : [
                {
                  name: "Fork CI required",
                  status: "completed",
                  conclusion: summary,
                },
              ];
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
for (let failAt = 1; failAt <= 6; failAt++) {
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
]) {
  test(`${name} prevents merge`, async () => {
    const f = fixture(scenario);
    await assert.rejects(mergeReviewed(options, f.api));
    assert.equal(f.merges(), 0);
  });
}
test("verification is read-only unless merge is explicit", async () => {
  const f = fixture();
  await mergeReviewed({ ...options, merge: false }, f.api);
  assert.equal(f.merges(), 0);
  await mergeReviewed(options, f.api);
  assert.equal(f.merges(), 1);
});
