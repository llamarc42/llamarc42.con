# Portable tool contract

Private, versioned schema and validator for the accepted tool-contract design.
Run `npm ci` and `npm test` in this directory; the same tests run on all CI OSes.
The runtime dependency is pinned Ajv 8 with JSON Schema draft 2020-12 support.

`parseManifest(jsonText)` validates metadata and the restricted input/output schema
dialect, rejects excessive definitions, and returns deeply frozen metadata.
`createRegistry(handlerDescriptors)` registers known handlers, rejects duplicate
names and understated effects, keeps tools disabled until explicitly enabled, and
validates calls/results without coercion. Unknown or disabled calls fail before
any handler is selected.

The first executable slice is `src/git-status.js`, using the bundled manifest in
`manifests/git-status.json`. It validates arguments and results, runs fixed Git
commands without a shell, bounds runtime and output, and returns a result envelope.
The schema is bundled with the extension; execution does not depend on source
files being present beside the installed extension.

In VS Code, enable **Continue: Enable Git Status Tool**, reload the window, and
use Agent mode. The existing tool approval UI defaults to asking permission.
Host enablement is checked again on every call. This slice supports local
workspaces on Windows, macOS, and Linux; Remote/WSL/Codespaces discovery is disabled
until execution can be routed to that workspace's host. Stale remote calls return
a structured error rather than running Git locally. Open exactly one repository root
as the workspace and have Git on PATH. Paths are repository-relative. Submodule
changes are excluded; multi-root selection and arbitrary external tool manifests
are not implemented in this slice.

The executable is resolved from absolute host PATH entries outside the workspace,
including checks of symlink targets. Containment compares device/inode identities
along the resolved ancestor directories, so case-insensitive filesystem aliases
cannot evade the check. Empty, relative, and workspace PATH entries
are ignored. Metadata-only Git commands read configuration and repository paths;
status uses a temporary private index, HEAD, and allowlisted configuration. The
original index is never written. The temporary copy is removed after success,
failure, timeout, or cancellation. A concurrent repository configuration change
cannot introduce commands into that isolated status invocation.

Content-filter commands (including Git LFS, clean filters, and persistent process
filters) are never copied into the private configuration. Known driver names are
retained as required drivers without executable commands: if status needs one,
the tool returns `unsupported_repository` instead of comparing unfiltered content.
Global/system filter definitions are included in this check. Sparse checkouts,
split indexes, partial clones, and unusual filter names are currently unsupported
on every OS. Ordinary repositories, unborn branches, and linked worktrees are
supported. Repository metadata paths containing newlines are unsupported; filenames
within an ordinary workspace remain NUL-delimited. The private index copy is
limited to 128 MiB and each copied info/attributes or info/exclude file to 64 KiB.

Successes and failures both reach the model as result envelopes, including invalid
arguments, disabled calls, unavailable workspaces, and Git execution failures.

`git_status` is reserved for the built-in, including while disabled. Conflicting
MCP/custom tools are excluded with a configuration warning; rename the MCP server
or custom tool to expose a distinct name. The UI carries the selected tool's URI
(or explicit built-in identity) through dispatch. Stale MCP calls and older
name-only Git status calls fail as unknown host tools; request a fresh call in
the updated extension. A known built-in call still returns `tool_disabled` after
the setting is turned off. Tool identity is dispatch metadata, not authorization.

Enabling a registry entry is not user approval to run it. This integration uses
the existing Continue approval flow; it does not yet implement the design's
independent invocation-bound authorization broker. The executor accepts an abort
signal, but the chat Stop button is not yet connected to it. A ten-second runtime
limit covers all subprocess phases and a cumulative 64 KiB subprocess output limit
applies, in addition to the 64 KiB structured result limit. These remaining host features are required
before claiming full conformance with the proposed execution contract.

V1 accepts stable three-component tool versions, the `builtin` adapter, and the
four documented effects. Other adapters require an explicit contract extension.
