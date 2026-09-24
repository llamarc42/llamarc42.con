import { expect, it } from "vitest";
import {
  encodeMCPToolUri,
  decodeMCPToolUri,
  mcpAppToolUri,
} from "./mcpToolUri";
import { resolveToolCall } from "./resolveToolCall";
import { gitStatusTool } from "./gitStatus";

it("keeps the embedded app's original server when requesting a sibling tool", () => {
  const server = "original/server #1";
  const uri = mcpAppToolUri(encodeMCPToolUri(server, "view"), "read/item?");
  expect(decodeMCPToolUri(uri)).toEqual([server, "read/item?"]);
  const original = {
    ...gitStatusTool(),
    function: { name: "shared_read", parameters: {} },
    uri,
  };
  const replacement = {
    ...original,
    uri: encodeMCPToolUri("replacement", "read/item?"),
  };
  expect(resolveToolCall([replacement, original], "shared_read", uri)).toBe(
    original,
  );
  expect(resolveToolCall([replacement], "shared_read", uri)).toBeUndefined();
  expect(
    resolveToolCall(
      [{ ...original, uri: "MCP://original/read" }],
      "shared_read",
    ),
  ).toBeUndefined();
});

it.each([undefined, "https://server/tool", "mcp:///tool", "not a URI"])(
  "rejects an app without valid saved MCP identity (%s)",
  (uri) => expect(() => mcpAppToolUri(uri, "read")).toThrow(),
);
