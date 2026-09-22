import { describe, expect, it, vi } from "vitest";
import { ToolExtras } from "..";
import { gitStatusImpl, gitStatusTool } from "./gitStatus";
import { callTool } from "./callTool";

describe("Git status host integration", () => {
  it("publishes the JSON schema with approval required", () => {
    const tool = gitStatusTool();
    expect(tool.function.name).toBe("git_status");
    expect(tool.function.parameters).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    });
    expect(tool.defaultToolPolicy).toBe("allowedWithPermission");
  });

  it("rechecks enablement before accessing the workspace", async () => {
    const getWorkspaceDirs = vi.fn();
    const extras = {
      ide: {
        getIdeSettings: async () => ({ enableGitStatusTool: false }),
        getWorkspaceDirs,
      },
    } as unknown as ToolExtras;
    await expect(gitStatusImpl({}, extras)).rejects.toThrow("tool_disabled");
    expect(getWorkspaceDirs).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON instead of turning it into empty arguments", async () => {
    const getIdeSettings = vi.fn();
    const extras = { ide: { getIdeSettings } } as unknown as ToolExtras;
    const result = await callTool(
      gitStatusTool(),
      {
        id: "invalid",
        type: "function",
        function: { name: "git_status", arguments: "{" },
      },
      extras,
    );
    expect(result.errorMessage).toContain("invalid_arguments");
    expect(getIdeSettings).not.toHaveBeenCalled();
  });

  it("rejects ambiguous workspaces", async () => {
    const extras = {
      ide: {
        getIdeSettings: async () => ({ enableGitStatusTool: true }),
        getWorkspaceDirs: async () => [],
      },
    } as unknown as ToolExtras;
    await expect(gitStatusImpl({}, extras)).rejects.toThrow(
      "exactly one workspace",
    );
  });
});
