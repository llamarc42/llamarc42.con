import Ajv2020 from "ajv/dist/2020.js";
import { readFileSync } from "node:fs";

export const LIMITS = Object.freeze({
  manifestBytes: 65536,
  depth: 12,
  properties: 128,
  collection: 256,
  timeoutMs: 120000,
  outputBytes: 1048576,
});

const makeAjv = () =>
  new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: true,
  });
const ajv = makeAjv();
const manifestSchema = JSON.parse(
  readFileSync(new URL("../schema/tool-manifest.schema.json", import.meta.url)),
);
const validateShape = ajv.compile(manifestSchema);

export class ContractError extends Error {
  constructor(code, details) {
    super(`${code}: ${details}`);
    this.code = code;
  }
}

function fail(details) {
  throw new ContractError("invalid_definition", details);
}

function bound(value, path = "", depth = 0) {
  if (depth > LIMITS.depth) fail(`${path}: maximum nesting exceeded`);
  if (!value || typeof value !== "object") return;
  const keys = Object.keys(value);
  if (
    keys.length > (Array.isArray(value) ? LIMITS.collection : LIMITS.properties)
  ) {
    fail(`${path}: too many entries`);
  }
  for (const key of keys) bound(value[key], `${path}/${key}`, depth + 1);
}

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function checkSchemaBounds(schema) {
  for (const [min, max] of [
    ["minimum", "maximum"],
    ["minLength", "maxLength"],
    ["minItems", "maxItems"],
  ]) {
    if (
      schema[min] !== undefined &&
      schema[max] !== undefined &&
      schema[min] > schema[max]
    )
      fail(`${min} cannot exceed ${max}`);
  }
  if (schema.properties)
    Object.values(schema.properties).forEach(checkSchemaBounds);
  if (schema.items) checkSchemaBounds(schema.items);
}

// Only JSON text crosses this boundary: callers cannot inject callbacks/prototypes.
export function parseManifest(text) {
  if (
    typeof text !== "string" ||
    Buffer.byteLength(text) > LIMITS.manifestBytes
  ) {
    fail("manifest must be JSON text of at most 65536 bytes");
  }
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch {
    fail("invalid JSON");
  }
  bound(manifest);
  if (!validateShape(manifest)) fail(ajv.errorsText(validateShape.errors));
  checkSchemaBounds(manifest.inputSchema);
  checkSchemaBounds(manifest.outputSchema);
  try {
    // Compilation validates nested schemas without coercion, defaults, or fetching.
    const compiler = makeAjv();
    compiler.compile(manifest.inputSchema);
    compiler.compile(manifest.outputSchema);
  } catch (error) {
    fail(error.message);
  }
  return freeze(manifest);
}

export function createRegistry(handlers) {
  const compiler = makeAjv();
  const registered = new Map();
  const names = new Set();
  const knownHandlers = new Map(
    handlers.map((handler) => [handler.id, freeze(structuredClone(handler))]),
  );
  return Object.freeze({
    register(text) {
      if (registered.size >= 256) fail("registry tool limit exceeded");
      const manifest = parseManifest(text);
      if (registered.has(manifest.id) || names.has(manifest.name)) {
        fail("duplicate tool ID or model-facing name");
      }
      const handler = knownHandlers.get(manifest.handler.id);
      if (!handler) fail("unknown handler");
      if (
        handler.effects.some((effect) => !manifest.effects.includes(effect))
      ) {
        fail("manifest omits required handler effects");
      }
      registered.set(manifest.id, {
        manifest,
        enabled: false,
        input: compiler.compile(manifest.inputSchema),
        output: compiler.compile(manifest.outputSchema),
      });
      names.add(manifest.name);
      return manifest;
    },
    setEnabled(id, enabled) {
      const tool = registered.get(id);
      if (!tool) throw new ContractError("unknown_tool", id);
      if (typeof enabled !== "boolean")
        throw new TypeError("enabled must be boolean");
      tool.enabled = enabled;
    },
    definitions() {
      return [...registered.values()]
        .filter((tool) => tool.enabled)
        .map(({ manifest }) => ({
          type: "function",
          function: {
            name: manifest.name,
            description: manifest.description,
            parameters: manifest.inputSchema,
          },
        }));
    },
    validateCall(name, args) {
      const tool = [...registered.values()].find(
        (t) => t.manifest.name === name,
      );
      if (!tool) throw new ContractError("unknown_tool", name);
      if (!tool.enabled) throw new ContractError("tool_disabled", name);
      if (!tool.input(args)) {
        throw new ContractError(
          "invalid_arguments",
          ajv.errorsText(tool.input.errors),
        );
      }
      return tool.manifest;
    },
    validateResult(id, data) {
      const tool = registered.get(id);
      if (!tool) throw new ContractError("unknown_tool", id);
      if (!tool.output(data)) {
        throw new ContractError(
          "invalid_result",
          ajv.errorsText(tool.output.errors),
        );
      }
      return data;
    },
  });
}
