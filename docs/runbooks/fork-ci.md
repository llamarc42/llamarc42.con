# Fork CI bootstrap

The accepted design is being introduced by the `tool-contract-ci` branch. Do not
merge until Copilot has reviewed the current head and the validation results have
been inspected. This document separates implemented checks from enforcement that
still needs a successful bootstrap.

## Implemented

- A standalone JSON Schema 2020-12 tool manifest and strict validator/registry in
  `packages/tool-contract`, with bounded definitions and no execution privileges.
- Preflight validation, workflow syntax checking, static checks, full offline
  desktop tests, and native VSIX packaging on three OS runners. The required
  summary fails on any failed, cancelled, or unexpectedly skipped stage.
- Node test tasks enforce minimum passing counts. Each Jest/Vitest task writes
  a fresh JSON report and must report at least one passing test, zero failures,
  and success; empty or entirely skipped runs fail validation.
- Preflight enforces the exact three-OS matrix and rejects skipped or ignored
  platform/summary jobs. The live merge guard also verifies that the actual
  `Fork CI required` job completed successfully in the latest run.
- A packaged-extension smoke harness: isolated VS Code 1.95.0, synthetic workspace,
  local scripted Ollama server, and actual list/read/answer continuation through
  the bundled model and tool dispatcher. This does not test the new JSON loader,
  which is a subsequent integration slice.
- A metadata-only Copilot gate using trusted default-branch code. It checks the
  current head, verified bot login/type, completed review state, and unresolved
  review conversations. It does not run PR code with write credentials.
- 31 inherited workflows preserved in `.github/upstream-workflows/`, outside
  GitHub's active workflow directory. Publishing and upstream integrations are
  not enabled by this change.

## Runtime and test inventory

The new workflow pins Node 22.22.0 to satisfy the observed build-tool engine floor
of 22.12. Local reproduction with the existing Node 20 baseline is recorded
separately; the new runtime's full matrix must pass before it is called validated.
Native builds pin Python 3.11.9 because the inherited SQLite/node-gyp toolchain
still imports `distutils`, which newer Python runtimes removed. On Windows, the
legacy POSIX quoting integration tests require Git for Windows' `bin/sh.exe` under
Program Files. Those tests establish POSIX quoting behavior, not cmd.exe or
PowerShell compatibility for legacy tools.
The fetch TLS fixtures use Git for Windows' `usr/bin/openssl.exe` to generate
real certificates; generation failures fail the tests rather than using fake PEM.
This is the latest 3.11 binary release in the setup-python manifest shared by
all configured platforms; later 3.11 entries are Linux-only. It is a build-time
compatibility pin, not a shipped application runtime. Updating the inherited
native toolchain is needed to move to a current Python feature series.

`core`: full Jest and Vitest suites. `gui`: full Vitest suite. `extensions/vscode`:
full Vitest suite plus packaged-extension smoke. Shared packages: config-yaml
Jest, terminal-security/fetch/openai-adapters Vitest, tool-contract Node tests.
Config-types, llm-info, and continue-sdk have upstream no-op test scripts; only
their available builds/type checks are evidence. Do not report those as tested.

The install steps receive no GitHub token. Before installation, a built-in Node
script downloads the existing pinned ripgrep release from its public asset URL,
verifies a checked-in SHA-256 digest, and fills the locked package's download
cache. This avoids the anonymous metadata API rate limit without exposing a
credential to npm lifecycle scripts. Package/version changes require reviewing
the asset pins. These digests were measured from the upstream HTTPS release;
they are integrity pins, not independent upstream signatures.

The existing `IGNORE_API_KEY_TESTS=true` branch excludes live provider tests from
credential-free CI; openai-adapters' existing Vitest config also excludes its live
test files. Existing skipped/todo tests are visible in runner summaries. This is
offline coverage, not a claim of complete external-service validation. Tests may
still reveal inherited network assumptions; classify and fix those explicitly.

Preflight blocks changes under retained CLI, IntelliJ, binary, or Rust sync paths
until a corresponding fork test lane is added. No required stages are skipped for
documentation-only PRs in this first implementation.

## Local audit findings

The initial Windows core Jest audit passed 400 tests before failing on creation
of a file symlink (`EPERM`) in `indexing/walkDir.test.ts`. This account lacks the
required native capability; the test remains required on CI.

The initial Windows core Vitest audit passed 110 tests before a Unix-only file URL
fixture failed in `runTerminalCommand.vitest.ts`. The fixture now constructs a URL
from a native temporary path with spaces. No platform skip was introduced.

All three initial local TypeScript checks pass. GUI lint exposed 25 inherited
barrel-export violations; enabling the omitted TSX coverage exposed nine more.
The bootstrap replaces those forwarding modules with direct imports and limits
the MCP compatibility declaration to the symbols actually consumed. The rule
remains enabled. The packaged Windows list/read/answer smoke passes locally;
this is not three-platform proof.

The complete Windows core audit also exposed native-path/URI confusion, CRLF
fixture parsing, transient file locks, and a hard-coded POSIX shell. Fixes keep
the assertions and use native paths, normalized fixture delimiters, isolated
temporary directories, and bounded cleanup retries. Native terminal tests allow
15 seconds for shell startup; production command-timeout tests remain separate.
HTTP provider tests mock Docker initialization so tests cannot enable a local
service. Packaging explicitly generates both YAML and RC schemas even when
dependency installation is skipped, and the smoke checks their presence.

The full local Jest audit reached 841 passing tests and identified three further
fixture problems: shell-based Git setup that did not switch Windows drives,
native paths supplied to a URI API, and another CRLF-delimited diff fixture.
All three corrected suites pass (50 tests). The symlink capability failure remains
required in CI. The Git fixture now uses argument arrays and an explicit temporary
working directory. Test-created nested Git metadata under `core/.git` was preserved
outside the checkout in `.build-tools/test-created-core-git-backup-20260922`; the
main repository was not replaced or reset. The extension's 86 unit tests and the
rebuilt Windows VSIX smoke also pass locally.

GitHub run 35761973058 passed the complete Node 22 matrix on Windows, macOS,
and Linux at commit `4ee8d3c9ca9aa7d0d48cea3c1c1703152ac0e1aa`, including
all three packaged-extension smokes. Subsequent review fixes require fresh CI.
The smoke's private extension API now requires VS Code's actual Test extension
mode, and the rebuilt Windows smoke passes with that restriction. Desktop CI
also skips the unrelated JetBrains webview copy during packaging.

## Bootstrap and enforcement

`fork-ci.yml` can validate its introducing PR. The privileged review workflow must
not run from unmerged PR code, so it will become operational only after its trusted
default-branch bootstrap. For that initial PR, verify Copilot's current-head review
directly before requesting a merge. Do not manufacture a passing review status.

Once bootstrapped, review metadata is refreshed after Fork CI and the Copilot workflow, PR
head changes, review submissions/edits/dismissals, review comments, manual dispatch,
and a five-minute scheduled check. Review events run a credential-free relay;
its completion triggers the trusted default-branch gate, which independently
queries live metadata and never consumes relay artifacts or code. GitHub can delay
event processing and scheduled runs; thread-resolution changes also rely on the
scheduled fallback. Always recheck live review metadata immediately before an
authorized merge. Event-driven refresh reduces latency; it is not an atomic merge
interlock against concurrent review changes.

Copilot-originated refresh workflows can be held with `action_required` before
any job starts. A five-minute schedule is not a five-minute service guarantee:
scheduled runs have been observed hours apart in this fork. The independent
Fork CI completion trigger helps refresh review state after ordinary CI even if
the Copilot event path is held. It takes effect only after this workflow change
is merged to the trusted default branch. It does not request another review or
weaken the review decision.

If the displayed status is stale after review or conversation resolution, run the
existing trusted gate explicitly:

```text
gh workflow run copilot-review-gate.yml --repo llamarc42/llamarc42.con --ref main
```

Check that the dispatched run succeeds and inspect the updated status description.
It may correctly remain pending for unresolved findings. This refresh grants no
merge approval, does not approve other workflows, and does not change repository
approval settings. The live merge guard below remains mandatory.

Commit statuses have no expiry. If GitHub's API cannot list PRs or write statuses,
a previously published success can remain visible even though the refresh job
fails. This is a platform limitation, not a successful verification: do not merge
during an unverifiable refresh, and do not enable auto-merge based on this status.
A live current-head review check is mandatory at merge time. This addresses
Copilot's API-outage finding through the executable merge guard below;
the workflow status is advisory, not an outage-proof authorization service.

Use a reviewed, trusted checkout to run:

```text
node scripts/ci/merge-reviewed.cjs llamarc42/llamarc42.con PR_NUMBER HEAD_SHA
```

This is read-only. For a separately user-authorized merge, append `--merge`.
The command reads the PR directly (no dependency on listing all PRs), requires
the latest Fork CI run for that head to pass, paginates current reviews and
conversations, and rechecks the head and base before a squash merge with GitHub's
expected-head SHA guard. Any failed API read aborts without issuing a merge.
It never uses a previous commit status as authorization or queues auto-merge.
It requires the reviewed head to contain current `main`, every expected CI job
to complete successfully exactly once, and the latest current-head Copilot agent
run to succeed. A timeout summary is insufficient. If the branch is behind main,
update it and obtain fresh CI/review. Inspect the full review body as well as
inline threads: summary-only findings still require a human or agent disposition.
Regression tests inject failure at each metadata read and assert zero merge calls.
Do not bypass a failed guard with a direct CLI/UI merge. This is the supported
agent merge path, not a claim that GitHub's UI or administrators cannot bypass it.
GitHub cannot atomically bind review state to a merge; the expected SHA prevents
head replacement, while review/base races after the final read remain subject
to repository rules. Those rules still need the bootstrap described below.

Configure required statuses `Fork CI required` and `Copilot review current head`
only after the real checks have been exercised. Require PRs, resolved conversations,
base-current validation, and no force push/deletion of main. Confirm missing/stale
review and failed-platform cases actually block merge. Ruleset settings have not
been changed by this implementation yet. No auto-merge is configured.
