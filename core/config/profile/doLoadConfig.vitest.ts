import { describe, expect, it, vi } from "vitest";

import type { PackageIdentifier } from "@continuedev/config-yaml";

// Mock heavy dependencies before importing doLoadConfig
const stubConfig = {
  models: [],
  rules: [],
  tools: [],
  slashCommands: [],
  contextProviders: [],
  modelsByRole: { chat: [], edit: [], apply: [], summarize: [], rerank: [] },
  selectedModelByRole: {},
  mcpServerStatuses: [],
  allowAnonymousTelemetry: false,
  experimental: {},
};
const mockLoadYaml = vi.fn().mockResolvedValue({
  config: { ...stubConfig },
  errors: [],
  configLoadInterrupted: false,
});
const mockLoadJson = vi.fn().mockResolvedValue({
  config: { ...stubConfig },
  errors: [],
  configLoadInterrupted: false,
});

vi.mock("../yaml/loadYaml", () => ({
  loadContinueConfigFromYaml: (...args: any[]) => mockLoadYaml(...args),
}));
vi.mock("../load", () => ({
  loadContinueConfigFromJson: (...args: any[]) => mockLoadJson(...args),
}));
vi.mock("../migrateSharedConfig", () => ({
  migrateJsonSharedConfig: vi.fn(),
}));
vi.mock("../getWorkspaceContinueRuleDotFiles", () => ({
  getWorkspaceContinueRuleDotFiles: vi
    .fn()
    .mockResolvedValue({ rules: [], errors: [] }),
}));
vi.mock("../markdown/loadMarkdownRules", () => ({
  loadMarkdownRules: vi.fn().mockResolvedValue({ rules: [], errors: [] }),
}));
vi.mock("../markdown/loadCodebaseRules", () => ({
  CodebaseRulesCache: { getInstance: () => ({ rules: [], errors: [] }) },
}));
vi.mock("../selectedModels", () => ({
  rectifySelectedModelsFromGlobalContext: (c: any) => c,
}));
vi.mock("../../context/mcp/MCPManagerSingleton", () => ({
  MCPManagerSingleton: { getInstance: () => ({ getStatuses: () => [] }) },
}));
vi.mock("../../tools", () => ({
  getConfigDependentToolDefinitions: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../tools/callTool", () => ({
  encodeMCPToolUri: vi.fn(),
}));
vi.mock("../../tools/mcpToolName", () => ({
  getMCPToolName: vi.fn(),
}));
vi.mock("../../util/tts", () => ({
  TTS: { setup: vi.fn() },
}));
vi.mock("../../util/GlobalContext", () => ({
  GlobalContext: class {
    get() {
      return {};
    }
    update() {}
  },
}));
vi.mock("../../promptFiles/initPrompt", () => ({
  initSlashCommand: { name: "init", description: "init" },
}));

// Mock fs.existsSync to simulate missing file on disk
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn().mockReturnValue(false),
    },
  };
});

import doLoadConfig from "./doLoadConfig.js";

const mockIde = {
  getIdeInfo: vi.fn().mockResolvedValue({
    ideType: "vscode",
    name: "VS Code",
    version: "1.90.0",
    remoteName: "wsl",
    extensionVersion: "1.3.31",
  }),
  getUniqueId: vi.fn().mockResolvedValue("test-id"),
  getIdeSettings: vi.fn().mockResolvedValue({}),
  showToast: vi.fn(),
  isTelemetryEnabled: vi.fn().mockResolvedValue(true),
  isWorkspaceRemote: vi.fn().mockResolvedValue(true),
} as any;

const mockLlmLogger = {} as any;

describe("doLoadConfig pre-read content bypass", () => {
  it("excludes every colliding local/HTTP/MCP definition while retaining unique names", async () => {
    const unique = { function: { name: "unique" } };
    mockLoadJson.mockResolvedValueOnce({
      config: {
        ...stubConfig,
        tools: [
          { function: { name: "collision" } },
          { function: { name: "collision" }, uri: "https://example.test/tool" },
          { function: { name: "collision" }, uri: "mcp://server/tool" },
          unique,
        ],
      },
      errors: [],
      configLoadInterrupted: false,
    });
    const result = await doLoadConfig({
      ide: mockIde,
      llmLogger: mockLlmLogger,
      profileId: "test-profile",
      packageIdentifier: { uriType: "file", fileUri: "test.yaml" },
    });
    expect(result.config?.tools).toEqual([unique]);
    expect(result.errors).toContainEqual({
      fatal: false,
      message: expect.stringContaining(
        'Excluded all 3 tools named "collision"',
      ),
    });
  });
  it("excludes external git_status names even when the built-in is disabled", async () => {
    mockLoadJson.mockResolvedValueOnce({
      config: {
        ...stubConfig,
        tools: [{ function: { name: "git_status" }, uri: "mcp://git/status" }],
      },
      errors: [],
      configLoadInterrupted: false,
    });
    const result = await doLoadConfig({
      ide: mockIde,
      llmLogger: mockLlmLogger,
      profileId: "test-profile",
      packageIdentifier: { uriType: "file", fileUri: "test.yaml" },
    });
    expect(result.config?.tools).toEqual([]);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fatal: false,
          message: expect.stringContaining("name is reserved"),
        }),
      ]),
    );
  });

  it("should use YAML loading when packageIdentifier has pre-read content, even if file does not exist on disk", async () => {
    mockLoadYaml.mockClear();
    mockLoadJson.mockClear();

    const packageIdentifier: PackageIdentifier = {
      uriType: "file",
      fileUri:
        "vscode-remote://wsl+Ubuntu/home/user/.continue/agents/test.yaml",
      content: "name: Test\nversion: 1.0.0\nschema: v1\n",
    };

    await doLoadConfig({
      ide: mockIde,

      llmLogger: mockLlmLogger,
      profileId: "test-profile",
      overrideConfigYamlByPath: packageIdentifier.fileUri,

      packageIdentifier,
    });

    expect(mockLoadYaml).toHaveBeenCalled();
    expect(mockLoadJson).not.toHaveBeenCalled();
  });

  it("should fall back to JSON loading when no content and file does not exist", async () => {
    mockLoadYaml.mockClear();
    mockLoadJson.mockClear();

    const packageIdentifier: PackageIdentifier = {
      uriType: "file",
      fileUri:
        "vscode-remote://wsl+Ubuntu/home/user/.continue/agents/test.yaml",
    };

    await doLoadConfig({
      ide: mockIde,

      llmLogger: mockLlmLogger,
      profileId: "test-profile",
      overrideConfigYamlByPath: packageIdentifier.fileUri,

      packageIdentifier,
    });

    expect(mockLoadYaml).not.toHaveBeenCalled();
    expect(mockLoadJson).toHaveBeenCalled();
  });
});
