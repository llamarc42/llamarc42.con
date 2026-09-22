const reviewer = "copilot-pull-request-reviewer[bot]";

function reviewDecision(head, reviews, unresolved) {
  const review = reviews
    .filter(
      (r) =>
        r.user?.login === reviewer &&
        r.user?.type === "Bot" &&
        r.commit_id === head,
    )
    .sort((a, b) => b.id - a.id)[0];
  if (
    !review ||
    !["COMMENTED", "APPROVED"].includes(review.state) ||
    !review.submitted_at
  ) {
    return {
      state: "pending",
      description: "Waiting for Copilot review of the current head",
    };
  }
  if (unresolved)
    return {
      state: "pending",
      description: "Resolve or disposition outstanding review conversations",
    };
  if (
    /couldn.t run.*review|didn.t start before the timeout/i.test(
      review.body || "",
    )
  )
    return {
      state: "pending",
      description:
        "Copilot reported an incomplete review; request another review",
    };
  return {
    state: "success",
    description: "Copilot reviewed current head; review conversations resolved",
  };
}

module.exports = { reviewDecision };
