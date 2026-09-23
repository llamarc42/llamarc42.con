import { describe, expect, it, vi } from "vitest";
import type { ToolExtras } from "..";
import { callTool } from "./callTool";
import { gitStatusTool } from "./gitStatus";
import { resolveToolCall } from "./resolveToolCall";

describe("tool dispatch identity", () => {
  const builtin = gitStatusTool();
  const mcp = { ...builtin, uri: "mcp://git-server/status" };

  it.each([[], [builtin], [mcp], [mcp, builtin]])(
    "never substitutes local Git for stale MCP or unidentified calls (%#)",
    (...tools) => {
      expect(resolveToolCall(tools, "git_status", mcp.uri)).toBeUndefined();
      expect(resolveToolCall(tools, "git_status")).toBeUndefined();
    },
  );

  it("selects the built-in by identity even if an external tool shares its name", () => {
    expect(resolveToolCall([mcp, builtin], "git_status", null)).toBe(builtin);
  });

  it("routes a captured built-in identity to the disabled envelope after reload", async () => {
    const getWorkspaceDirs = vi.fn();
    const tool = resolveToolCall([], "git_status", null)!;
    const result = await callTool(
      tool,
      {
        id: "stale",
        type: "function",
        function: { name: "git_status", arguments: "{}" },
      },
      {
        ide: {
          getIdeSettings: async () => ({ enableGitStatusTool: false }),
          getWorkspaceDirs,
        },
      } as unknown as ToolExtras,
    );
    expect(JSON.parse(result.contextItems[0].content).error.code).toBe(
      "tool_disabled",
    );
    expect(getWorkspaceDirs).not.toHaveBeenCalled();
  });

  it("matches an MCP URI and rejects removal or replacement under the same name", () => {
    const tool = {
      ...mcp,
      function: { ...mcp.function, name: "other_status" },
    };
    expect(resolveToolCall([tool], "other_status", tool.uri)).toBe(tool);
    expect(resolveToolCall([], "other_status", tool.uri)).toBeUndefined();
    expect(
      resolveToolCall(
        [{ ...tool, uri: "mcp://replacement/status" }],
        "other_status",
        tool.uri,
      ),
    ).toBeUndefined();
  });
});
