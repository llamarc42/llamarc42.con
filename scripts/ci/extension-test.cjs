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
  for (const argumentsText of ["{", '{"command":"not allowed"}']) {
    const result = await host.core.invoke("tools/call", {
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
    const result = await host.core.invoke("tools/call", { toolCall: call });
    assert.ok(!result.errorMessage, result.errorMessage);
    messages.push({
      role: "tool",
      toolCallId: call.id,
      content: result.contextItems.map((item) => item.content).join("\n"),
    });
  }
  assert.deepEqual(called, ["ls", "read_file", "git_status"]);
  assert.ok(answer.includes("L42-CI-CONTINUATION"));
};
