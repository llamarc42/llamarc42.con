import type { Tool, ToolCall } from "core";
import { describe, expect, it, vi } from "vitest";
import { createMockStore, getEmptyRootState } from "../../util/test/mockStore";
import type { AppThunkDispatch } from "../store";
import { callToolById } from "./callToolById";

vi.mock("./streamResponseAfterToolCall", () => ({
  streamResponseAfterToolCall: () => async () => ({ payload: undefined }),
}));

describe("captured tool identity", () => {
  it.each(["mcp://removed-server/status", null, undefined])(
    "sends the saved identity (%s), not the current same-name tool",
    async (uri) => {
      const state = getEmptyRootState();
      state.config.config.selectedModelByRole.chat = {
        title: "test",
        model: "test",
        provider: "openai",
        underlyingProviderName: "openai",
      };
      const tool: Tool = {
        type: "function",
        function: { name: "git_status", description: "test", parameters: {} },
        displayTitle: "Git status",
        wouldLikeTo: "test",
        isCurrently: "testing",
        hasAlready: "tested",
        readonly: true,
        group: "Built-In",
      };
      const toolCall: ToolCall = {
        id: "saved-call",
        type: "function",
        function: { name: "git_status", arguments: "{}" },
      };
      state.config.config.tools = [tool];
      state.session.history = [
        {
          message: {
            id: "assistant",
            role: "assistant",
            content: "",
            toolCalls: [toolCall],
          },
          contextItems: [],
          toolCallStates: [
            {
              toolCallId: toolCall.id,
              toolCall,
              status: "generated",
              parsedArgs: {},
              tool:
                uri === undefined
                  ? undefined
                  : { ...tool, uri: uri ?? undefined },
            },
          ],
        },
      ];
      const store = createMockStore(state);
      store.mockIdeMessenger.responses["tools/call"] = { contextItems: [] };
      const request = vi.spyOn(store.mockIdeMessenger, "request");
      const result = await (store.dispatch as AppThunkDispatch)(
        callToolById({ toolCallId: toolCall.id }),
      );
      expect(result.meta.requestStatus).toBe("fulfilled");
      expect(request).toHaveBeenCalledWith("tools/call", {
        toolCall,
        toolUri: uri,
      });
    },
  );
});
