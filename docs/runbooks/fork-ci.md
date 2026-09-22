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
This is the latest 3.11 binary release in the setup-python manifest shared by
all configured platforms; later 3.11 entries are Linux-only. It is a build-time
compatibility pin, not a shipped application runtime. Updating the inherited
native toolchain is needed to move to a current Python feature series.

`core`: full Jest and Vitest suites. `gui`: full Vitest suite. `extensions/vscode`:
full Vitest suite plus packaged-extension smoke. Shared packages: config-yaml
Jest, terminal-security/fetch/openai-adapters Vitest, tool-contract Node tests.
Config-types, llm-info, and continue-sdk have upstream no-op test scripts; only
their available builds/type checks are evidence. Do not report those as tested.

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

## Bootstrap and enforcement

`fork-ci.yml` can validate its introducing PR. The privileged review workflow must
not run from unmerged PR code, so it will become operational only after its trusted
default-branch bootstrap. For that initial PR, verify Copilot's current-head review
directly before requesting a merge. Do not manufacture a passing review status.

Once bootstrapped, review metadata is refreshed after the Copilot workflow, PR
head changes, review submissions/edits/dismissals, review comments, manual dispatch,
and a five-minute scheduled check. Review events run a credential-free relay;
its completion triggers the trusted default-branch gate, which independently
queries live metadata and never consumes relay artifacts or code. GitHub can delay
event processing and scheduled runs; thread-resolution changes also rely on the
scheduled fallback. Always recheck live review metadata immediately before an
authorized merge. Event-driven refresh reduces latency; it is not an atomic merge
interlock against concurrent review changes.

Commit statuses have no expiry. If GitHub's API cannot list PRs or write statuses,
a previously published success can remain visible even though the refresh job
fails. This is a platform limitation, not a successful verification: do not merge
during an unverifiable refresh, and do not enable auto-merge based on this status.
A live current-head review check is mandatory at merge time. This addresses
Copilot's API-outage finding by documenting the remaining enforcement limit;
the workflow is an asynchronous aid, not an outage-proof authorization service.

Configure required statuses `Fork CI required` and `Copilot review current head`
only after the real checks have been exercised. Require PRs, resolved conversations,
base-current validation, and no force push/deletion of main. Confirm missing/stale
review and failed-platform cases actually block merge. Ruleset settings have not
been changed by this implementation yet. No auto-merge is configured.
