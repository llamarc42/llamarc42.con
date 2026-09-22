import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRegistry, parseManifest } from "../src/index.js";

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/git-status.json", import.meta.url)),
);
const text = (modify = () => {}) => {
  const value = structuredClone(fixture);
  modify(value);
  return JSON.stringify(value);
};
const handlers = [
  { id: "git.status", effects: ["workspace.read", "process.execute"] },
];

test("valid manifest is immutable and retains the portable schema", () => {
  const manifest = parseManifest(text());
  assert.deepEqual(manifest, fixture);
  assert.throws(() => {
    manifest.handler.id = "other";
  }, TypeError);
});

for (const [name, modify] of [
  [
    "unknown version",
    (m) => {
      m.schemaVersion = 2;
    },
  ],
  [
    "OS opt-out",
    (m) => {
      m.platforms = ["win32"];
    },
  ],
  [
    "shell command",
    (m) => {
      m.handler.command = "git status";
    },
  ],
  [
    "unknown adapter",
    (m) => {
      m.handler.adapter = "process";
    },
  ],
  [
    "open object",
    (m) => {
      m.inputSchema.additionalProperties = true;
    },
  ],
  [
    "remote schema",
    (m) => {
      m.inputSchema.$ref = "https://example.com/schema";
    },
  ],
  [
    "unknown required field",
    (m) => {
      m.inputSchema.required = ["missing"];
    },
  ],
  [
    "excessive timeout",
    (m) => {
      m.limits.timeoutMs = 120001;
    },
  ],
  [
    "zero output cap",
    (m) => {
      m.limits.maxOutputBytes = 0;
    },
  ],
  [
    "unrecognized effect",
    (m) => {
      m.effects = ["admin"];
    },
  ],
  [
    "implicit default",
    (m) => {
      m.inputSchema.default = {};
    },
  ],
]) {
  test(`rejects ${name}`, () => {
    assert.throws(() => parseManifest(text(modify)), {
      code: "invalid_definition",
    });
  });
}

test("malformed, oversized, and deeply nested definitions fail before activation", () => {
  for (const value of [
    "{",
    " ".repeat(65537),
    JSON.stringify({ x: Array(257).fill(1) }),
  ]) {
    assert.throws(() => parseManifest(value), { code: "invalid_definition" });
  }
  assert.throws(
    () =>
      parseManifest(
        text((m) => {
          let schema = m.inputSchema;
          for (let i = 0; i < 20; i++) {
            schema.properties.child = {
              type: "object",
              properties: {},
              additionalProperties: false,
            };
            schema = schema.properties.child;
          }
        }),
      ),
    { code: "invalid_definition" },
  );
});

test("registration cannot select an unknown handler or downgrade its effects", () => {
  assert.throws(() => createRegistry([]).register(text()), /unknown handler/);
  assert.throws(
    () =>
      createRegistry(handlers).register(
        text((m) => {
          m.effects = ["workspace.read"];
        }),
      ),
    /required handler effects/,
  );
});

test("duplicate IDs and model names are rejected", () => {
  const registry = createRegistry(handlers);
  registry.register(text());
  assert.throws(() => registry.register(text()), /duplicate/);
  assert.throws(
    () =>
      registry.register(
        text((m) => {
          m.id = "another.tool";
        }),
      ),
    /duplicate/,
  );
});

test("disabled tools stay absent and invocations are rejected after revocation", () => {
  const registry = createRegistry(handlers);
  registry.register(text());
  assert.deepEqual(registry.definitions(), []);
  assert.throws(() => registry.validateCall("git_status", {}), {
    code: "tool_disabled",
  });
  registry.setEnabled(fixture.id, true);
  assert.equal(registry.definitions().length, 1);
  assert.equal(registry.validateCall("git_status", {}).id, fixture.id);
  assert.throws(
    () => registry.validateCall("git_status", { command: "anything" }),
    { code: "invalid_arguments" },
  );
  assert.throws(() => registry.validateCall("made_up", {}), {
    code: "unknown_tool",
  });
  registry.setEnabled(fixture.id, false);
  assert.throws(() => registry.validateCall("git_status", {}), {
    code: "tool_disabled",
  });
  assert.deepEqual(registry.definitions(), []);
});

test("results are validated without coercion or removal of unknown fields", () => {
  const registry = createRegistry(handlers);
  registry.register(text());
  const data = {
    entries: [
      { path: "space dir/日本語.txt", indexStatus: "?", worktreeStatus: "?" },
    ],
  };
  assert.deepEqual(registry.validateResult(fixture.id, data), data);
  assert.throws(() => registry.validateResult(fixture.id, { entries: "[]" }), {
    code: "invalid_result",
  });
  assert.throws(
    () => registry.validateResult(fixture.id, { ...data, extra: 1 }),
    { code: "invalid_result" },
  );
});
