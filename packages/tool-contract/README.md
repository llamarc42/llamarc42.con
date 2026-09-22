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

This package does not execute tools, grant permissions, discover configuration,
or change the Continue UI. Enabling a registry entry is not user approval to run
it. Host dispatch still needs invocation-bound authorization, limits, cancellation,
and result envelopes before runtime integration is complete.

The `git-status.json` fixture describes the first proposed handler. It does not
install or implement that handler. V1 currently accepts stable three-component
tool versions, the `builtin` adapter, and the four documented effects. Other
adapters require an explicit contract extension.
