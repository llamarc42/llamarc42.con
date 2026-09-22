import Ollama from "./Ollama.js";

// Capture the real adapter's serialized request without contacting Ollama.
// Only the current request's tools may be exposed, including on continuations.
describe.each([false, true])("Ollama request schemas (stream=%s)", (stream) => {
  const tool = {
    type: "function",
    function: {
      name: "workspace_read_file",
      description: "Read a synthetic fixture",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
    },
  };
  const user = { role: "user", content: "Read fixture.txt" };
  const assistant = {
    role: "assistant",
    content: "",
    toolCalls: [
      {
        id: "fixture-call",
        type: "function",
        function: {
          name: tool.function.name,
          arguments: '{"path":"fixture.txt"}',
        },
      },
    ],
  };
  const result = {
    role: "tool",
    content: "synthetic fixture",
    toolCallId: "fixture-call",
  };
  let initial: any;
  let continuation: any;
  let revoked: any;
  let empty: any;
  let multipleResults: any;
  let secondContinuation: any;
  let changedTools: any;
  let omittedAfterTool: any;
  const replacement = {
    ...tool,
    function: { ...tool.function, name: "git_status" },
  };

  beforeAll(async () => {
    const adapter = Object.create(Ollama.prototype);
    adapter.apiBase = "http://localhost:11434/";
    adapter.ensureModelInfo = jest.fn().mockResolvedValue(undefined);
    adapter._getModel = () => "synthetic-model";
    adapter._getModelFileParams = () => ({});

    async function capture(messages: any[], tools?: any[]) {
      const boundary = new Error("synthetic transport boundary");
      const signal = new AbortController().signal;
      let request: any;
      adapter.fetch = jest.fn(async (url: URL, init: any) => {
        expect(url.pathname).toBe("/api/chat");
        expect(init.method).toBe("POST");
        expect(init.signal).toBe(signal);
        request = JSON.parse(init.body);
        throw boundary;
      });
      await expect(
        adapter._streamChat(messages, signal, { stream, tools }).next(),
      ).rejects.toBe(boundary);
      expect(adapter.fetch).toHaveBeenCalledTimes(1);
      expect(request.stream).toBe(stream);
      expect(request.messages.map((message: any) => message.role)).toEqual(
        messages.map((message) => message.role),
      );
      return request;
    }

    initial = await capture([user], [tool]);
    continuation = await capture([user, assistant, result], [tool]);
    // Same adapter and history, but permission set has been revoked.
    revoked = await capture([user, assistant, result], []);
    empty = await capture([user]);
    const secondCall = { ...assistant.toolCalls[0], id: "fixture-call-2" };
    const secondResult = { ...result, toolCallId: secondCall.id };
    multipleResults = await capture(
      [
        user,
        { ...assistant, toolCalls: [...assistant.toolCalls, secondCall] },
        result,
        secondResult,
      ],
      [tool],
    );
    secondContinuation = await capture(
      [
        user,
        assistant,
        result,
        { ...assistant, toolCalls: [secondCall] },
        secondResult,
      ],
      [tool],
    );
    changedTools = await capture([user, assistant, result], [replacement]);
    omittedAfterTool = await capture([user, assistant, result]);
  });

  it("sends the supplied schema on the initial request", () => {
    expect(initial.tools).toEqual([tool]);
  });

  it("retains currently permitted schemas after a tool result", () => {
    expect(continuation.tools).toEqual([tool]);
  });

  it("does not restore revoked schemas from history", () => {
    expect(revoked.tools).toBeUndefined();
  });

  it("does not expose tools when none were supplied", () => {
    expect(empty.tools).toBeUndefined();
    expect(omittedAfterTool.tools).toBeUndefined();
  });

  it("retains schemas after multiple tool results and a second tool round", () => {
    expect(multipleResults.tools).toEqual([tool]);
    expect(secondContinuation.tools).toEqual([tool]);
  });

  it("uses the current schema set when tools change between requests", () => {
    expect(changedTools.tools).toEqual([replacement]);
  });
});
