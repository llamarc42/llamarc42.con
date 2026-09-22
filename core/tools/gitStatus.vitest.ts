import { describe, expect, it, vi } from "vitest";
import { IDE, ToolExtras } from "..";
import { getConfigDependentToolDefinitions } from "./index";
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
    const result = JSON.parse((await gitStatusImpl({}, extras))[0].content);
    expect(result).toMatchObject({
      status: "error",
      complete: false,
      error: { code: "tool_disabled" },
    });
    expect(getWorkspaceDirs).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON instead of turning it into empty arguments", async () => {
    const getIdeSettings = vi
      .fn()
      .mockResolvedValue({ enableGitStatusTool: true });
    const getWorkspaceDirs = vi.fn();
    const extras = {
      ide: { getIdeSettings, getWorkspaceDirs },
      toolCallId: "invalid",
    } as unknown as ToolExtras;
    const result = await callTool(
      gitStatusTool(),
      {
        id: "invalid",
        type: "function",
        function: { name: "git_status", arguments: "{" },
      },
      extras,
    );
    expect(result.errorMessage).toBeUndefined();
    expect(JSON.parse(result.contextItems[0].content)).toMatchObject({
      invocationId: "invalid",
      status: "error",
      error: { code: "invalid_arguments" },
    });
    expect(getWorkspaceDirs).not.toHaveBeenCalled();
  });

  it("rejects ambiguous workspaces", async () => {
    const extras = {
      ide: {
        getIdeSettings: async () => ({ enableGitStatusTool: true }),
        isWorkspaceRemote: async () => false,
        getWorkspaceDirs: async () => [],
      },
    } as unknown as ToolExtras;
    const result = JSON.parse((await gitStatusImpl({}, extras))[0].content);
    expect(result.error.code).toBe("tool_failed");
    expect(result.error.message).toContain("exactly one workspace");
  });

  it.each([false, true])(
    "discovers Git status only when enabled in a local workspace (remote=%s)",
    async (isRemote) => {
      for (const enabled of [false, true]) {
        const ide = {
          getIdeSettings: async () => ({ enableGitStatusTool: enabled }),
          getWorkspaceDirs: async () => [],
          fileExists: async () => false,
        } as unknown as IDE;
        const tools = await getConfigDependentToolDefinitions({
          ide,
          isRemote,
          rules: [],
          modelName: "",
          enableExperimentalTools: false,
        });
        expect(tools.some((tool) => tool.function.name === "git_status")).toBe(
          enabled && !isRemote,
        );
      }
    },
  );

  it("rejects stale remote calls before reading local workspace paths", async () => {
    const getWorkspaceDirs = vi.fn();
    const extras = {
      ide: {
        getIdeSettings: async () => ({ enableGitStatusTool: true }),
        isWorkspaceRemote: async () => true,
        getWorkspaceDirs,
      },
    } as unknown as ToolExtras;
    const result = JSON.parse((await gitStatusImpl({}, extras))[0].content);
    expect(result).toMatchObject({
      status: "error",
      error: { code: "tool_failed" },
    });
    expect(result.error.message).toContain("local workspace");
    expect(getWorkspaceDirs).not.toHaveBeenCalled();
  });

  it("returns unsupported URIs as structured errors without mapping them to local paths", async () => {
    const extras = {
      ide: {
        getIdeSettings: async () => ({ enableGitStatusTool: true }),
        isWorkspaceRemote: async () => false,
        getWorkspaceDirs: async () => [
          "vscode-remote://ssh-remote+host/workspace",
        ],
      },
    } as unknown as ToolExtras;
    const result = JSON.parse((await gitStatusImpl({}, extras))[0].content);
    expect(result.error.code).toBe("tool_failed");
    expect(result.error.message).toContain("file URI");
  });
});
