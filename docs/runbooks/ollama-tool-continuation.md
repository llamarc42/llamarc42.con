# Ollama tool continuation: first implementation slice

Date: 2026-09-22. Based on Continue `v2.0.0-vscode`, commit
`03b05ef60c378ff06f9e39ada2e22c95fe9ef6ad` on local branch `baseline-build`.

## Change

The Ollama adapter previously sent function schemas only when the last message
was a user message. After a tool result, the next request omitted those schemas.
The adapter now includes the current request's nonempty `options.tools` regardless
of the final message role. It does not reconstruct tools from conversation history.
Empty or omitted tool sets still produce no schemas.

This is a transport correction, not a new permission system or tool registry.

## Automated validation

Both Ollama suites pass: 22 tests total (10 existing and 12 request-boundary
regressions). Core TypeScript checking passes. The new regression covers streaming
and nonstreaming requests, initial requests, continuations, multiple results,
multiple rounds, changed tools, and empty/omitted tools after a tool result.

The request-boundary tests use actual conversion, reordering, and serialization;
they stub model metadata and stop before network I/O. Logs are stored locally in
`../.build-tools/ollama-fixed-tests.log` and `core-fixed-typecheck.log`.

## Package

The Windows x64 VSIX rebuilt successfully using the portable Node 20 toolchain
documented in [the baseline runbook](windows-baseline-build.md).

- Artifact: `extensions/vscode/build/continue-win32-x64-2.0.0.vsix`
- Size: 74,443,651 bytes
- SHA256: `e55e26745c8ac3be50a9e13b5ea3bea7a1d5613f3b1bf61fc660d25dffffd669`
- Build log: `../.build-tools/vsix-fixed-build.log`

The extension identity/version remains `Continue.continue@2.0.0`; use the hash
to distinguish this local fix from the preserved baseline artifact. This is not
a published or branded release.

All 11 baseline lockfile hashes remain unchanged. The preserved baseline VSIX
also retains its original SHA256 recorded in the baseline runbook.

## Isolated installation

VS Code rejected an in-place replacement of the running same-version extension
with "Please restart VS Code before reinstalling". The stale installation entry
was removed using the CLI against only the isolated profile, then the fixed VSIX
was successfully installed in `../.build-tools/vscode-baseline/extensions-fixed`.
The launcher now uses that directory; user data, profile, synthetic workspace,
and Continue storage retain their prior isolated locations.

The installed `out/extension.js` matches the VSIX entry byte-for-byte by SHA256:
`bdda80ad7138aef3def0aa879a841051166ad6311fed29715bab549689eae4fd`.
The window title is now `LLAMARC42 TOOL FIX`. The saved baseline VSIX remains
available for rollback. The previous extension directory contains installer
temporary files and is no longer selected by the launcher.

Use `extensions-fixed` instead of `extensions` in any subsequent CLI commands
for this test profile, including the baseline runbook's uninstall command.

## Live verification

The isolated profile's previously empty configuration now selects local Ollama
`qwen3-coder:30b` with tool support. Its prior config is saved alongside it as
`config.pre-tool-fix.yaml`. The normal Continue configuration is not involved.

The streaming live smoke test passed in 68 seconds using the real adapter's
request serialization and response parser against local Ollama. The model called
`workspace_list`, `workspace_read_file`, and `git_status` in separate rounds, then
answered with token `L42-TOOL-ROUND-3` and `?? README.md` (untracked).
All four captured requests included all three current schemas.

The harness allowed only three fixed read-only operations in a synthetic workspace;
Git was invoked with fixed arguments, never model-generated shell text. Metadata
lookup/options were stubbed to select the installed model, temperature 0, context
8192, and a 1024-token output cap. This verifies a real streaming adapter round
trip, not the public BaseLLM loop, VS Code's tool dispatcher, or approval UX.
Nonstreaming behavior is covered at the request boundary only.

Machine-local reproduction: copy `../.build-tools/Ollama.live-smoke.test.ts` to
`core/llm/llms/`, run the core Jest command with that test's path, then remove the
temporary copy. The harness and synthetic fixture are deliberately separate from
the normal offline suite. Results: `../.build-tools/ollama-live-smoke.log`.

## Installed UI smoke result

The restarted fixed installation activated successfully at 10:39:53 on
2026-09-22. In Continue's Plan mode with `Local Qwen3 Coder`, the prompt asked
for a workspace listing followed by reading `README.md` in a separate tool round
and reporting the token, without terminal commands or file modifications.

The UI showed completed "Continue listed files in ." and "Continue read
README.md" tool cards, followed by a final answer containing the correct token
`L42-TOOL-ROUND-3`. This verifies the installed extension's file-tool continuation
through its normal UI. Git status was verified by the separate live harness;
terminal-tool execution and its approval UX were not exercised through the UI.

The test window remains open with the completed result and the distinct
`LLAMARC42 TOOL FIX` title. No changes were pushed or published during validation.
