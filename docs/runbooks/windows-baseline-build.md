# Windows baseline build record

Date: 2026-09-22

## Source and scope

- Upstream: https://github.com/continuedev/continue.git
- Fork: https://github.com/llamarc42/llamarc42.con
- Local branch: `baseline-build`
- Baseline: `v2.0.0-vscode`, commit `03b05ef60c378ff06f9e39ada2e22c95fe9ef6ad`
- Preserve upstream Apache-2.0 license. No llamarc42 GPL code has been copied.
- This is an unchanged application baseline, not the separately branded fork release.
- Do not install the baseline VSIX into the normal profile: it still has Continue's identity.
- No pushes, publishing, or GitHub Actions enablement are part of this build.

## Local runtime

The machine has system Node 24.15.0 / npm 11.12.1. For baseline reproduction,
portable Node 20.20.1 / npm 10.8.2 was downloaded from nodejs.org into the workspace's sibling
`.build-tools` directory. Its ZIP SHA-256 matched the official SHASUMS256.txt:

`499e886ed617abb37d5e3a2b87a3f737e3c673b146361fb5ee70d08d7fdf6d2b`

In PowerShell, from the repository root:

```powershell
. ..\.build-tools\use-node.ps1
```

This changes only the current terminal environment. The npm cache is also in
`.build-tools`. Husky is disabled for the baseline installation. Puppeteer's browser
download is skipped; browser-based features/e2e tests are not validated by this build.
There is no global Vite installation or global npm linking.

## Dependency setup

Initial commands (run from the repository root using the environment above):

```powershell
npm.cmd ci --no-audit --no-fund
node scripts/build-packages.js
```

`CI=true` makes `build-packages.js` use `npm ci`. Separately, run `npm.cmd ci
--no-audit --no-fund` in `core`, `gui`, and `extensions/vscode`, checking each exit
code before proceeding. Dependency installation runs native package setup scripts.
No blanket dependency updates or `npm audit fix` are part of this baseline.

## Packaging constraints found during inspection

- The Windows all-dependencies script uses `npm install`, global `npm link`, and
  installs docs/binary dependencies beyond the VS Code baseline. It was not run.
- `npm run package` invokes `prepackage` automatically; prepackage normally runs
  more `npm install` commands and replaces generated output directories.
- `SKIP_INSTALLS=true` bypasses some installations/downloads, but does not prevent
  the LanceDB fallback from installing an unversioned native package if missing.
  Verify that native package is present at the lockfile version first.
- SQLite, ONNX, ripgrep, and LanceDB native assets must exist before packaging.
- Build timestamp generation means byte-identical VSIX output is not established.
- The inherited release workflows contain publishing steps and token references.
  Their remote enabled/disabled state has not been verified.

## Packaging command

After successful dependency installation and GUI build, verify that the installed
Windows LanceDB package is version 0.4.20 and the local `vsce` executable exists.
From the repository root with the helper environment loaded:

```powershell
npm.cmd --prefix gui run build
# Stop here if the build returns a nonzero exit code.
$env:SKIP_INSTALLS = 'true'
$env:CONTINUE_VSCODE_TARGET = 'win32-x64'
Push-Location extensions/vscode
npm.cmd run package -- --target win32-x64
Pop-Location
```

The first build used these settings after checking the native files and local
packager. Prepackage reported all required paths present and used the installed
LanceDB and SQLite binaries. Do not run the packager with missing prerequisites
and assume `SKIP_INSTALLS` prevents every fallback download.

## Results

- Portable runtime installed and verified; system Node/npm unchanged.
- Root `npm ci`: passed (325 packages; deprecation warnings).
- All seven support-package installs/builds passed (`config-types`,
  `terminal-security`, `llm-info`, `fetch`, `config-yaml`, `openai-adapters`,
  `continue-sdk`). The SDK build is upstream's no-op script.
- Core dependency installation passed: 1,365 packages. SQLite, Sharp, and ONNX
  Windows native binaries were installed without adding a compiler toolchain.
- GUI dependency installation passed: 1,157 packages.
- VS Code dependency installation passed: 1,190 packages.
- Core TypeScript check passed.
- GUI TypeScript/Vite production build passed. Warnings: stale Browserslist data
  and chunks exceeding 500 kB.
- VS Code TypeScript check passed.
- Terminal-security tests: 224 passed. The first sandboxed attempt failed to spawn
  esbuild (`EPERM`); the approved execution outside the sandbox passed.
- Fetch streaming tests (`npm.cmd --prefix packages/fetch test -- src/stream.test.ts`):
  11 passed.
- Existing Ollama tests: 10 passed after support packages were built. An earlier
  attempt ran zero tests because `openai-adapters` was not built yet.
- Total existing focused tests: 245 passed.
- Eleven input lockfile hashes are recorded in the sibling
  `.build-tools/baseline-inputs.json`; no lockfile changes observed.
- Some locked release tooling (`@semantic-release/npm@13.1.5`) requires Node
  `^22.14.0 || >=24.10.0`, despite the repository's Node 20.20.1 pin. Installation
  reported engine warnings. Do not describe the entire dependency graph as
  compatible solely because the application manifest accepts Node 20.
- VS Code installation additionally warns that `@electron/rebuild@4.0.3` and
  `node-abi@4.26.0` require Node >=22.12.0, and about Vite's Node type peer range.
- Windows VSIX packaging passed. Subsequent isolated installation is recorded
  below. No model/tool runtime smoke test, rollback test, or public distribution
  was performed.
- A dependency/security/license audit remains separate work.

## Baseline artifact

- File: `extensions/vscode/build/continue-win32-x64-2.0.0.vsix`
- Size: 74,443,663 bytes; 397 ZIP entries.
- SHA-256: `884b1bdddeabaa274aa8a8834518e4591e15bd600bba85b2db9efb9f4c71bc79`
- Manifest identity verified inside archive: `Continue.continue`, version `2.0.0`.
- Verified nonempty archive entries: extension bundle, GUI entry point, SQLite,
  LanceDB, ripgrep, and ONNX native binding.
- All 11 recorded lockfile hashes remained unchanged after packaging. Tracked
  upstream application source remained unchanged; this slice adds documentation
  and the transport regression fixture only.
- Build logs and machine-local input/artifact records are in the sibling
  `.build-tools` directory. The VSIX is a baseline artifact, not a branded release.

## Request-boundary reproduction

This section records the original baseline result. The subsequent fix removes
the expected-failure markers and expands the regression suite; see
[Ollama tool continuation](ollama-tool-continuation.md).

`core/llm/llms/Ollama.transport.test.ts` intercepts the real adapter's serialized
`api/chat` request. Model metadata lookup and unrelated model-option helpers are
stubbed; the transport throws a sentinel after capture, before any network I/O.
It exercises actual message conversion, reordering, and request construction.
It does not test the public BaseLLM loop, response parsing, compaction, or a real model.

For both `stream=false` and `stream=true`, initial user requests contain the
supplied schema. A continuation ending in a tool result omits `tools` entirely.
Empty/revoked tool sets remain absent. An ordinary regression run recorded exactly
two failed continuation assertions (`Received: undefined`) and six passing controls.
Its output is in the sibling `.build-tools/ollama-transport-red.log`.

The two known defects are retained using Jest `it.failing`; the fixture/setup and
six control assertions must still pass normally. The eight-case suite passes in
that expected-failure mode. This means the omission is reproduced, not fixed.
The adapter source is unchanged. Remove the expected-failure markers when applying
the subsequent adapter fix. No causal claim about real-model behavior is established.

## Isolated installation (2026-09-22)

The hash-verified baseline VSIX was installed into the `llamarc42 baseline`
profile using VS Code 1.138.0. The CLI reported successful installation and
`--list-extensions --show-versions` returned `continue.continue@2.0.0`.

All test paths are under the sibling `.build-tools/vscode-baseline` directory:

- VS Code `--user-data-dir`: `user-data`
- VS Code `--extensions-dir`: `extensions`
- `CONTINUE_GLOBAL_DIR`: `continue-data`
- Synthetic workspace: `workspace`

Launch from the repository root with:

```powershell
& ..\.build-tools\launch-baseline.ps1
```

The launcher clears the CLI IPC routing variable for its process, selects the
isolated directories/profile, disables Settings Sync for that window, and opens
the test workspace. It does not copy existing Continue settings or credentials.
VS Code creates a named profile when opening it; installing directly into a
nonexistent named profile fails, so the profile was opened before installation.

At the initial inspection, installation was confirmed but successful Continue activation and model/tool execution
were not yet confirmed. No Continue activation entry or data files
were present. The renderer also logged a safeStorage decryption error; its impact
on extension activation has not been established. Open the Continue panel in the
test window and reload that window if prompted before the interactive smoke test.

Follow-up inspection confirmed Continue activation at 10:18:50 on 2026-09-22.
The empty isolated model configuration was subsequently set to the local
`qwen3-coder:30b` model for the continuation-fix checks. The original VSIX is
preserved at `../.build-tools/artifacts/continue-win32-x64-2.0.0-baseline.vsix`.

To uninstall only this baseline, close its test windows and use the same paths:

```powershell
code --user-data-dir ..\.build-tools\vscode-baseline\user-data --extensions-dir ..\.build-tools\vscode-baseline\extensions --profile 'llamarc42 baseline' --uninstall-extension Continue.continue
```

Keep the directory flags when uninstalling. The ordinary VS Code installation
and normal Continue storage were not selected for installation or removal.
