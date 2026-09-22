# Proposed portable tool contract, version 1

Status: design for review, 2026-09-22. No loader, validator, or runtime behavior
is introduced by this document.

## Objective

Define what a tool exposes so the host can discover it, validate its inputs,
select a known handler, apply permissions, execute it, and return a predictable
result. The same definition must work on Windows, macOS, and Linux.

The 15 tools observed in the UI are a starting inventory, not a completeness
target. `core/tools/index.ts` selects tools by model, experimental settings, and
remote mode. `core/index.d.ts` already defines the internal `Tool` type, including
model-facing function parameters and UI text, but it also contains executable
callbacks. It is not itself a portable JSON installation contract.

Use a language-neutral manifest and adapt it to the existing internal type.
Keep tool metadata, host execution context, and results as separate contracts.

## Proposed manifest

| Field           | Requirement and meaning                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------------------------- |
| `schemaVersion` | Required; integer `1`. Reject unsupported versions.                                                                  |
| `id`            | Required, stable namespaced identifier, e.g. `llamarc42.git.status`.                                                 |
| `version`       | Required semantic version of the tool's behavioral contract.                                                         |
| `name`          | Required model-facing name; portable ASCII identifier, maximum 64 characters. Must be unique in the active registry. |
| `displayName`   | Required human-readable UI label.                                                                                    |
| `description`   | Required explanation of what the tool does and when to use it.                                                       |
| `inputSchema`   | Required closed object schema for arguments.                                                                         |
| `outputSchema`  | Required closed object schema for successful result data.                                                            |
| `handler`       | Required host-registered adapter and handler ID; no executable code or shell text.                                   |
| `effects`       | Required explicit capabilities, e.g. `workspace.read`, `workspace.write`, `process.execute`, `network.access`.       |
| `limits`        | Required positive timeout and output-byte limits, bounded by host ceilings.                                          |

The JSON Schema document describing this manifest should use draft 2020-12 and
reject unknown properties. Input/output schemas initially use a documented,
provider-compatible subset: objects, arrays, strings, integers, numbers,
booleans, enum, required fields, and basic size/range constraints. Object schemas
must reject additional properties. No remote references, executable defaults,
automatic coercion, or schema network retrieval. Set explicit nesting, property,
manifest-size, and collection limits in the implementation.

The validator must validate the embedded schemas themselves, not merely check
that they are JSON objects. Validate arguments before dispatch and result data
before exposing it to the model. Unsupported constructs fail at registration.

Example proposal:

```json
{
  "schemaVersion": 1,
  "id": "llamarc42.git.status",
  "version": "1.0.0",
  "name": "git_status",
  "displayName": "Git status",
  "description": "Read changed and untracked paths in the selected workspace repository.",
  "inputSchema": {
    "type": "object",
    "properties": {},
    "additionalProperties": false
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "entries": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "path": { "type": "string" },
            "indexStatus": { "type": "string" },
            "worktreeStatus": { "type": "string" },
            "originalPath": { "type": "string" }
          },
          "required": ["path", "indexStatus", "worktreeStatus"],
          "additionalProperties": false
        }
      }
    },
    "required": ["entries"],
    "additionalProperties": false
  },
  "handler": { "adapter": "builtin", "id": "git.status" },
  "effects": ["workspace.read", "process.execute"],
  "limits": { "timeoutMs": 10000, "maxOutputBytes": 65536 }
}
```

The handler registry owns dependency requirements and executable resolution.
For this example it probes Git, uses fixed argument arrays and an explicit
working directory, and parses a machine-readable, NUL-delimited status format.
It does not execute a model-supplied command or accept a model-supplied repository
root. A tool needing a subdirectory later receives a separately validated
workspace-relative argument. No user identity, credential, or absolute machine
path belongs in this definition.

## Host responsibilities

The invocation context is supplied by the host: invocation ID, selected workspace,
validated arguments, cancellation signal, effective permissions, and limits.
The model cannot override it. Metadata cannot grant permission: the effective
policy must satisfy both the handler's requirements and the user's current
configuration. A manifest cannot downgrade a handler's effects.

Validate definitions before activation; show malformed definitions in diagnostics
with field paths and reasons. Reject duplicate IDs/names rather than silently
overwriting a built-in. Enablement is local host configuration, not a pack's
self-authorization. Disabled tools are neither advertised nor callable, including
when requested through old history. Unknown or invalid calls cause no execution.

Recheck permission at invocation time and bind any approval to the exact tool
version, definition digest, arguments, workspace, and effects. Only send the
current permitted name, description, and argument schema to the model. Handler
routing and permission metadata stay host-side.

Results use a host-owned envelope with invocation ID, tool ID/version, status,
structured data or error, duration, and explicit completeness information.
Statuses are `success`, `error`, and `cancelled`. Success data must conform to
`outputSchema`; error/cancellation results do not carry success data.

Stable error codes include `unknown_tool`, `tool_disabled`, `invalid_arguments`,
`permission_denied`, `prerequisite_missing`, `spawn_failed`, `authentication_failed`,
`authorization_failed`, `timeout`, `cancelled`, `output_limit_exceeded`,
`invalid_result`, and `tool_failed`. Show actionable messages without credentials
or unrestricted process output. Initial v1 fails explicitly on output overflow;
it must not report a partial Git status as a complete success. Pagination is a
future explicit contract change. Do not retry mutations automatically.

## Cross-platform acceptance

There is no platform opt-out in the v1 manifest. A supported tool must pass the
same conformance fixtures on actual Windows, macOS, and Linux runners. OS-specific
implementations are allowed; OS-specific product semantics are not.

- Same tool name, argument schema, structured output, and error taxonomy.
- Workspace-relative paths use `/` in structured output; preserve filename case
  and Unicode. Normalize transport formatting, not file contents or path identity.
- Test spaces, Unicode, CRLF/LF content, symlinks, missing files, Git rename and
  untracked entries, and workspaces outside the repository root.
- Enforce containment using resolved filesystem paths; handle Windows drives,
  UNC paths, case sensitivity, and symlink escape without string-prefix shortcuts.
- Missing dependencies give the same `prerequisite_missing` result and useful
  OS-specific installation guidance. Supported prerequisite versions are declared
  and tested; different package-manager instructions do not imply different tools.
- Enforce timeouts, cancellation, output limits, and process-tree cleanup on each
  OS. Tests must exercise native execution, not only mock `process.platform`.
- Declare supported CPU architectures separately from OS coverage. Three OS
  runners do not establish every OS/architecture combination.

Inherited `run_terminal_command` is a known exception to the desired experience:
it exposes platform-dependent command strings and selects different shells.
Do not claim it conforms, remove it silently, or treat it as the extensible-tool
execution API. Inventory inherited tools as conformant, needs adaptation, or
legacy; migrate them deliberately. A PowerShell dependency alone does not make
all command semantics portable.

## First implementation and acceptance gate

After design acceptance: publish the manifest schema, add valid/invalid fixtures,
implement validation and immutable registration, and adapt one `git_status`
definition to its fixed built-in handler. No process bindings, MCP pack lifecycle,
or unrestricted plugins in this slice.

Acceptance: discovery in the UI, identical structured Git results on all three
OSes, a model continuation after the tool result, rejected malformed definitions,
zero execution for disabled/unknown tools, and deterministic failures for missing
Git, invalid results, timeouts, cancellation, and output overflow.

The host integration remains in the fork; this proposal does not introduce a
second governance authority or change the planned C# shared-core boundary. A
broader policy engine requires the architecture decision identified in the
original implementation plan.
