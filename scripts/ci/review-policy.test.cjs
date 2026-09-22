const { test } = require("node:test");
const assert = require("node:assert/strict");
const { reviewDecision } = require("./review-policy.cjs");
const review = {
  id: 1,
  user: { login: "copilot-pull-request-reviewer[bot]", type: "Bot" },
  commit_id: "current",
  state: "COMMENTED",
  submitted_at: "2026-09-22T16:08:38Z",
};
for (const [name, reviews, unresolved, expected] of [
  ["missing review", [], false, "pending"],
  ["stale review", [{ ...review, commit_id: "old" }], false, "pending"],
  ["dismissed review", [{ ...review, state: "DISMISSED" }], false, "pending"],
  [
    "requested changes",
    [{ ...review, state: "CHANGES_REQUESTED" }],
    false,
    "pending",
  ],
  ["pending submission", [{ ...review, submitted_at: null }], false, "pending"],
  [
    "human impersonation",
    [{ ...review, user: { ...review.user, type: "User" } }],
    false,
    "pending",
  ],
  ["unresolved conversation", [review], true, "pending"],
  ["completed current review", [review], false, "success"],
  [
    "approved current review",
    [{ ...review, state: "APPROVED" }],
    false,
    "success",
  ],
  [
    "latest review wins",
    [review, { ...review, id: 2, state: "DISMISSED" }],
    false,
    "pending",
  ],
]) {
  test(name, () =>
    assert.equal(
      reviewDecision("current", reviews, unresolved).state,
      expected,
    ),
  );
}
