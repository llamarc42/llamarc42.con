const assert = require("node:assert/strict");
const vscode = require("vscode");

exports.run = async function () {
  const extension = vscode.extensions.getExtension("Continue.continue");
  assert.ok(extension, "Packaged extension must be discoverable");
  const api = await extension.activate();
  assert.ok(api?.extension, "Activation must return the existing test API");
  const host = api.extension;
  const { config } = await host.configHandler.loadConfig();
  assert.ok(config, "Isolated test config must load");
  const model = config.selectedModelByRole.chat;
  assert.equal(model.model, "qwen3-coder:30b");
  const tools = config.tools.filter((tool) =>
    ["ls", "read_file", "git_status"].includes(tool.function.name),
  );
  assert.equal(tools.length, 3);
  const gitTool = tools.find((tool) => tool.function.name === "git_status");
  assert.equal(gitTool.defaultToolPolicy, "allowedWithPermission");
  assert.equal(gitTool.function.parameters.additionalProperties, false);
  const originalGetIdeSettings = host.core.ide.getIdeSettings;
  try {
    host.core.ide.getIdeSettings = async () => {
      throw new Error("smoke settings failure");
    };
    const result = await host.core.invoke("tools/call", {
      toolUri: null,
      toolCall: {
        id: "settings-failure",
        type: "function",
        function: { name: "git_status", arguments: "{}" },
      },
    });
    assert.equal(result.errorMessage, undefined);
    assert.equal(result.contextItems.length, 1);
    const envelope = JSON.parse(result.contextItems[0].content);
    assert.equal(envelope.invocationId, "settings-failure");
    assert.equal(envelope.error.code, "tool_failed");
    assert.equal(envelope.error.message, "smoke settings failure");
    assert.equal(envelope.complete, false);
  } finally {
    host.core.ide.getIdeSettings = originalGetIdeSettings;
  }
  // A stored MCP identity, or an old call with no identity, must never invoke
  // the now-enabled local built-in merely because its model-facing name matches.
  for (const toolUri of ["mcp://removed-git-server/status", undefined]) {
    await assert.rejects(
      host.core.invoke("tools/call", {
        toolUri,
        toolCall: {
          id: "stale-mcp-status",
          type: "function",
          function: { name: "git_status", arguments: "{}" },
        },
      }),
      /Tool git_status not found/,
    );
  }
  for (const argumentsText of ["{", '{"command":"not allowed"}']) {
    const result = await host.core.invoke("tools/call", {
      toolUri: gitTool.uri ?? null,
      toolCall: {
        id: "invalid-git-status",
        type: "function",
        function: { name: "git_status", arguments: argumentsText },
      },
    });
    assert.equal(result.errorMessage, undefined);
    const envelope = JSON.parse(result.contextItems[0].content);
    assert.equal(envelope.invocationId, "invalid-git-status");
    assert.equal(envelope.status, "error");
    assert.equal(envelope.error.code, "invalid_arguments");
    assert.equal(envelope.complete, false);
  }
  const messages = [
    {
      role: "user",
      content:
        "List the workspace, read README.md, then report the fixture token.",
    },
  ];
  const called = [];
  let answer = "";
  for (let round = 0; round < 4; round++) {
    const assistant = { role: "assistant", content: "", toolCalls: [] };
    for await (const chunk of model.streamChat(
      messages,
      AbortSignal.timeout(30000),
      { tools, stream: true },
    )) {
      if (chunk.role !== "assistant") continue;
      assistant.content += chunk.content || "";
      assistant.toolCalls.push(...(chunk.toolCalls || []));
    }
    messages.push(assistant);
    if (!assistant.toolCalls.length) {
      answer = assistant.content;
      break;
    }
    assert.equal(assistant.toolCalls.length, 1);
    const call = assistant.toolCalls[0];
    assert.equal(
      call.function.name,
      ["ls", "read_file", "git_status"][called.length],
    );
    called.push(call.function.name);
    const selectedTool = tools.find(
      (tool) => tool.function.name === call.function.name,
    );
    const result = await host.core.invoke("tools/call", {
      toolCall: call,
      toolUri: selectedTool.uri ?? null,
    });
    assert.ok(!result.errorMessage, result.errorMessage);
    messages.push({
      role: "tool",
      toolCallId: call.id,
      content: result.contextItems.map((item) => item.content).join("\n"),
    });
  }
  assert.deepEqual(called, ["ls", "read_file", "git_status"]);
  assert.ok(answer.includes("L42-CI-CONTINUATION"));
  await vscode.workspace
    .getConfiguration("continue")
    .update("enableGitStatusTool", false, vscode.ConfigurationTarget.Global);
  await host.configHandler.reloadConfig("git-status-disabled-smoke");
  const { config: disabledConfig } = await host.configHandler.loadConfig();
  assert.ok(
    !disabledConfig.tools.some((tool) => tool.function.name === "git_status"),
  );
  const stale = await host.core.invoke("tools/call", {
    toolUri: gitTool.uri ?? null,
    toolCall: {
      id: "disabled-git-status",
      type: "function",
      function: { name: "git_status", arguments: "{}" },
    },
  });
  assert.equal(stale.errorMessage, undefined);
  const disabledEnvelope = JSON.parse(stale.contextItems[0].content);
  assert.equal(disabledEnvelope.invocationId, "disabled-git-status");
  assert.equal(disabledEnvelope.error.code, "tool_disabled");
  assert.equal(disabledEnvelope.complete, false);
  assert.equal(disabledEnvelope.data, undefined);
};
