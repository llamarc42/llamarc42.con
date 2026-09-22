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
`manifests/git-status.json`. It validates arguments and results, runs a fixed Git
command without a shell, bounds runtime and output, and returns a result envelope.
The schema is bundled with the extension; execution does not depend on source
files being present beside the installed extension.

In VS Code, enable **Continue: Enable Git Status Tool**, reload the window, and
use Agent mode. The existing tool approval UI defaults to asking permission.
Host enablement is checked again on every call. Open exactly one repository root
as the workspace and have Git on PATH. Paths are repository-relative. Submodule
changes are excluded; multi-root selection and arbitrary external tool manifests
are not implemented in this slice.

Enabling a registry entry is not user approval to run it. This integration uses
the existing Continue approval flow; it does not yet implement the design's
independent invocation-bound authorization broker. The executor accepts an abort
signal, but the chat Stop button is not yet connected to it. A ten-second runtime
limit and 64 KiB output limit apply. These remaining host features are required
before claiming full conformance with the proposed execution contract.

V1 accepts stable three-component tool versions, the `builtin` adapter, and the
four documented effects. Other adapters require an explicit contract extension.
