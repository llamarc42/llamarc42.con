# Proposed PR validation and review gate

Status: design for review, 2026-09-22. This document does not enable workflows,
change GitHub settings, or claim CI coverage exists today.

## Current evidence

- Local source includes inherited PR, release, publishing, and automation workflows.
- GitHub's workflow API listed only the active Copilot workflow at inspection.
  Actions were enabled, but PR #1 had no CI check rollup before merge.
- The repository ruleset API returned no rulesets; `main` protection returned
  `Branch not protected`. Workflow files alone do not enforce merge requirements.
- Copilot reviewed PR #1's head `4503fc865` at 16:08:38 UTC, after its 16:05:39 UTC
  merge. It submitted a `COMMENTED` review and no inline review comments. Future
  merges must wait for the review, as requested by the user.

## Validation stages

Every PR to `main` runs an always-present pipeline against the proposed merge
with the base branch. Do not place path filters on the whole required workflow.

| Stage                 | Checks                                                                                                                                                                | Dependency / failure behavior                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Preflight             | Workflow syntax, changed-file formatting, manifest/schema validity, fixture consistency, dependency/lockfile consistency                                              | Fast Linux job; failure prevents expensive stages.                                    |
| Static validation     | Build shared packages, type checking, targeted linting without silently overlooking changed code                                                                      | After preflight; fail immediately on a failed command.                                |
| Deterministic tests   | Full offline core, GUI, shared-package, and VS Code test suites within the supported desktop surface; provider mocks, schema/registry/dispatcher/policy tests         | After static validation; no production credentials or live model required.            |
| Platform conformance  | Identical tool fixtures and native execution tests on Windows, macOS, Linux                                                                                           | Three required matrix legs, `fail-fast: true`; a cancelled sibling is not a pass.     |
| Build and integration | Native VSIX build for each selected OS/architecture, artifact contents/native dependency checks, VS Code extension-host smoke tests with a deterministic model server | After test stages; build the actual merge candidate, not an unrelated cached bundle.  |
| Required CI summary   | Verify every expected job/leg passed and test inventories were nonempty                                                                                               | Always runs; failure, cancellation, missing results, or unexpected skip blocks merge. |
| Copilot review gate   | Completed Copilot review for current PR head; findings addressed or disposition recorded                                                                              | Separate from build CI; required before merge.                                        |

Start with Windows x64, Linux x64, and macOS arm64 runners with explicit labels
and recorded architecture. Additional distribution architectures need their own
native smoke coverage before claiming support. Packaging on three OSes is not
equivalent to testing every architecture that upstream published.

"Fully test" means complete declared automated coverage of the supported product,
not proof of every behavior. Inventory existing suites first. Preserve a visible
distinction between deterministic tests, external-service tests, and manual/live
model measurement. Do not silently skip existing failures or remove tests to make
the new gate green. Document any inherited failures and resolve the required scope
before enabling the gate.

Changes affecting retained CLI, binary, JetBrains, or other surfaces require those
surfaces' relevant checks too; unsupported changes must not slip through a desktop-
only gate. Introduce change-based selection only after proving the dependency map.
Documentation-only PRs still receive preflight and Copilot review; any permitted
stage skips must be explicit, tested decisions checked by the summary job.

## Fail-fast operation

- Cancel obsolete runs when a newer commit arrives on the same PR, without
  cancelling unrelated PRs. Review-only events must not cancel build CI.
- Put cheap checks before dependency-heavy builds. Set bounded timeouts for each
  job, test process, and tool invocation. Fail on zero tests where tests are expected.
- Use `npm ci` and pinned runtime/action versions. Cache package downloads with
  OS, architecture, runtime, and lockfile keys; never share native `node_modules`
  across platforms or trust caches as validation evidence.
- Separate shell steps or use a checked cross-platform command runner so an early
  failed command cannot be masked by a later successful command. PowerShell native
  exit codes need explicit handling.
- Keep logs and failed-test artifacts even on failure; do not re-run flaky tests
  indefinitely until green. Fix or explicitly classify failures.
- A matrix's `fail-fast` cancels its siblings, not every unrelated workflow.
  Use stage dependencies to prevent unnecessary later work.

The pinned Node 20.20.1 baseline is a reproduction input, not a permanent runtime
decision. Reconcile the build toolchain's observed engine warnings and select a
supported runtime before calling this a maintained release pipeline.

## Copilot and merge policy

Require a completed, non-dismissed review authored by GitHub's verified Copilot
reviewer identity whose `commit_id` matches the current PR head. A workflow named
Copilot, a requested reviewer, an issue comment, or a review of an earlier head
does not satisfy this requirement. Paginate review API results. Missing reviews,
API errors, quota exhaustion, and unavailable Copilot keep the gate unsatisfied.

A completed `COMMENTED` review satisfies review completion, but is not approval
of the findings. Read the review body and inline threads. Address actionable
findings or record a specific disposition before resolving conversations. Never
mark comments resolved solely to obtain a green check. Changes after review
require fresh validation and a new review covering that head.

Configure automatic Copilot reviews, including review of new pushes. GitHub
documents those as separate options. Optional Copilot approval settings are not
a substitute for verifying that this reviewer has reviewed the current head.
See [GitHub's review configuration documentation](https://docs.github.com/en/copilot/how-tos/copilot-on-github/set-up-copilot/configure-code-review).

The proposed review gate must run trusted code from the default branch and inspect
GitHub metadata only. It must never execute PR code or interpolate PR titles,
review bodies, or branch names into shell commands with elevated credentials.
Limit any status-writing permission to that metadata gate; untrusted build jobs
use read-only tokens and no secrets.

Recompute review status on PR head changes, review submission/dismissal, and an
explicit refresh. Conversation resolution may require a refresh; do not rely on
an event GitHub does not deliver to the selected workflow. Check PRs, reviews, and
head SHA again immediately before merging, and use an expected-head guard.
Implementation must prove the gate works with actual Copilot review events before
it becomes a required check.

## Repository enforcement and rollout

1. Inventory inherited workflows and disable or guard publishing, scheduled
   mutation, and upstream-specific integrations before activating fork CI. Do not
   indiscriminately enable all inherited workflows.
2. Implement pipeline scripts and the schema fixtures on a feature branch. Use
   deterministic, isolated workspaces and synthetic repositories. Keep live Ollama
   measurement separate from the mandatory credential-free CI lane.
3. Exercise the workflow on a PR, including intentional failures. Confirm a bad
   schema fails before builds; one failed OS leg, zero tests, or a skipped required
   stage makes the aggregate gate fail.
4. Exercise Copilot review gating with no review, stale review, new push,
   dismissed review, unresolved findings, and completed current-head review.
5. Configure an active `main` ruleset requiring PRs, the stable aggregate CI check,
   the review-completion check, resolved conversations, and validation current with
   the base branch (or an explicitly supported merge queue). Disallow force pushes
   and branch deletion. Avoid automatic administrative bypass.
6. Verify the merge is actually blocked when either gate is unsatisfied. Only then
   describe the checks as enforced. The bootstrap PR itself must wait for Copilot
   and available validation; do not create an exception that merges it unread.

Merge authorization remains a separate user decision. No automatic merge,
publication, remote settings change, or workflow enablement is part of this design
review. The immediate standing instruction is recorded in the root `AGENTS.md`.
