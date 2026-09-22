const { execFileSync } = require("node:child_process");
const { reviewDecision } = require("./review-policy.cjs");

// Status badges are advisory. This path always reads fresh metadata before a
// user-authorized merge and never falls back to a cached success on API errors.
async function mergeReviewed({ repo, number, sha, merge = false }, api) {
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(repo) ||
    !Number.isSafeInteger(number) ||
    number < 1 ||
    !/^[a-f0-9]{40}$/.test(sha)
  )
    throw new Error(
      "Expected owner/repo, positive PR number, and full head SHA",
    );
  const endpoint = `repos/${repo}/pulls/${number}`;
  const first = await api.get(endpoint);
  function checkPr(pr) {
    if (
      pr.state !== "open" ||
      pr.draft ||
      pr.head.sha !== sha ||
      pr.base.ref !== "main"
    )
      throw new Error(
        "PR must be open, ready, and match the requested head on main",
      );
    if (pr.auto_merge)
      throw new Error("Disable auto-merge before using the live merge guard");
  }
  checkPr(first);
  const runs = await api.get(
    `repos/${repo}/actions/workflows/fork-ci.yml/runs?event=pull_request&head_sha=${sha}&per_page=100`,
  );
  const latest = runs.workflow_runs
    .filter((run) => run.head_sha === sha && run.event === "pull_request")
    .sort((a, b) => b.id - a.id)[0];
  if (
    !latest ||
    latest.status !== "completed" ||
    latest.conclusion !== "success"
  )
    throw new Error("Latest Fork CI run for this head must pass");
  const reviews = await api.pages(`${endpoint}/reviews?per_page=100`);
  const unresolved = await api.unresolved(repo, number);
  const decision = reviewDecision(sha, reviews, unresolved);
  if (decision.state !== "success") throw new Error(decision.description);
  const current = await api.get(endpoint);
  checkPr(current);
  if (current.base.sha !== first.base.sha)
    throw new Error("Base changed during verification; retry validation");
  if (!merge) return { verified: true, sha };
  // GitHub atomically checks the expected head; never use --admin or auto-merge.
  const result = await api.merge(`${endpoint}/merge`, sha);
  if (result.merged !== true) throw new Error("GitHub refused the merge");
  return result;
}

function githubApi() {
  const gh = (args) =>
    JSON.parse(
      execFileSync("gh", ["api", ...args], {
        encoding: "utf8",
        timeout: 60000,
        maxBuffer: 16 * 1024 * 1024,
      }),
    );
  return {
    get: (endpoint) => gh([endpoint]),
    pages: (endpoint) => gh([endpoint, "--paginate", "--slurp"]).flat(),
    unresolved: (repo, number) => {
      const [owner, name] = repo.split("/");
      let cursor = null;
      let unresolved = false;
      do {
        const args = [
          "graphql",
          "-f",
          "query=query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$cursor){nodes{isResolved} pageInfo{hasNextPage endCursor}}}}}",
          "-f",
          `owner=${owner}`,
          "-f",
          `name=${name}`,
          "-F",
          `number=${number}`,
        ];
        if (cursor) args.push("-f", `cursor=${cursor}`);
        const result = gh(args);
        if (result.errors) throw new Error("Review thread query failed");
        const threads = result.data.repository.pullRequest.reviewThreads;
        unresolved ||= threads.nodes.some((thread) => !thread.isResolved);
        cursor = threads.pageInfo.hasNextPage
          ? threads.pageInfo.endCursor
          : null;
      } while (cursor);
      return unresolved;
    },
    merge: (endpoint, sha) =>
      gh([
        endpoint,
        "--method",
        "PUT",
        "-f",
        `sha=${sha}`,
        "-f",
        "merge_method=squash",
      ]),
  };
}

if (require.main === module) {
  const [repo, number, sha, mode, ...extra] = process.argv.slice(2);
  if (extra.length || (mode && mode !== "--merge"))
    throw new Error("Usage: merge-reviewed.cjs owner/repo PR SHA [--merge]");
  mergeReviewed(
    {
      repo: repo || "",
      number: Number(number),
      sha: sha || "",
      merge: mode === "--merge",
    },
    githubApi(),
  )
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
module.exports = { mergeReviewed };
