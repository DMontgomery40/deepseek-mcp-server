import { afterEach, describe, expect, it, vi } from "vitest";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { ConversationStore } from "../src/conversation-store.js";
import { DeepSeekApiClient } from "../src/deepseek/client.js";
import { createDeepSeekMcpServer } from "../src/mcp-server.js";

interface Harness {
  serverClose: () => Promise<void>;
  client: Client;
  api: {
    createChatCompletion: ReturnType<typeof vi.fn>;
    createCompletion: ReturnType<typeof vi.fn>;
    createResponse: ReturnType<typeof vi.fn>;
    uploadFile: ReturnType<typeof vi.fn>;
    listFiles: ReturnType<typeof vi.fn>;
    retrieveFile: ReturnType<typeof vi.fn>;
    deleteFile: ReturnType<typeof vi.fn>;
    listModels: ReturnType<typeof vi.fn>;
    getUserBalance: ReturnType<typeof vi.fn>;
  };
}

async function createHarness(defaultModel = "deepseek-flash"): Promise<Harness> {
  const file = {
    id: "file-api-test1",
    object: "file",
    bytes: 8,
    created_at: 10,
    filename: "pixel.png",
    purpose: "user_data",
  };
  const api = {
    createChatCompletion: vi.fn(async (request) => ({
      response: {
        id: "chat-1",
        object: "chat.completion",
        created: 1,
        model: String(request.model),
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: `assistant:${String(request.messages.at(-1)?.content ?? "")}`,
              reasoning_content: request.thinking?.type === "enabled" ? "reasoning" : undefined,
            },
          },
        ],
      },
    })),
    createCompletion: vi.fn(async (request) => ({
      response: {
        id: "cmpl-1",
        object: "text_completion",
        created: 1,
        model: String(request.model),
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            text: "completion-text",
          },
        ],
      },
    })),
    createResponse: vi.fn(async (request) => ({
      response: {
        id: "resp-1",
        object: "response",
        created_at: 1,
        status: "completed",
        model: String(request.model),
        output: [
          {
            type: "message",
            id: "msg-1",
            status: "completed",
            role: "assistant",
            content: [{ type: "output_text", text: "response-text" }],
          },
        ],
        usage: {
          input_tokens: 2,
          output_tokens: 1,
          total_tokens: 3,
        },
      },
    })),
    uploadFile: vi.fn(async () => file),
    listFiles: vi.fn(async () => ({
      object: "list",
      data: [file],
      first_id: file.id,
      last_id: file.id,
      has_more: false,
    })),
    retrieveFile: vi.fn(async () => file),
    deleteFile: vi.fn(async () => ({
      id: file.id,
      object: "file",
      deleted: true,
    })),
    listModels: vi.fn(async () => ({
      object: "list",
      data: [
        { id: "deepseek-flash", object: "model" },
        { id: "deepseek-v4-pro", object: "model" },
      ],
    })),
    getUserBalance: vi.fn(async () => ({
      is_available: true,
      balance_infos: [
        {
          currency: "USD",
          total_balance: "9.99",
          granted_balance: "0.00",
          topped_up_balance: "9.99",
        },
      ],
    })),
  };

  const mcpServer = createDeepSeekMcpServer({
    client: api as unknown as DeepSeekApiClient,
    conversations: new ConversationStore(200),
    defaultModel,
    version: "test",
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "test-client",
    version: "1.0.0",
  });

  await Promise.all([mcpServer.connect(serverTransport), client.connect(clientTransport)]);

  return {
    serverClose: async () => {
      await client.close();
      await mcpServer.close();
    },
    client,
    api,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createDeepSeekMcpServer", () => {
  it("registers only documented DeepSeek API tools", async () => {
    const harness = await createHarness();

    try {
      const tools = await harness.client.listTools();
      const names = tools.tools.map((tool) => tool.name).sort();
      const toolsByName = new Map(tools.tools.map((tool) => [tool.name, tool]));

      expect(names).toEqual([
        "chat_completion",
        "completion",
        "create_response",
        "delete_file",
        "get_user_balance",
        "list_conversations",
        "list_files",
        "list_models",
        "reset_conversation",
        "retrieve_file",
        "upload_file",
      ]);

      for (const tool of tools.tools) {
        expect(tool.inputSchema).toMatchObject({ type: "object" });
        expect(tool.outputSchema).toMatchObject({ type: "object" });
      }

      expect(toolsByName.get("list_files")?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: true,
      });
      expect(toolsByName.get("delete_file")?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      });
      expect(toolsByName.get("reset_conversation")?.annotations).toMatchObject({
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      });
    } finally {
      await harness.serverClose();
    }
  });

  it("persists conversation history by conversation_id for chat_completion", async () => {
    const harness = await createHarness();

    try {
      const first = await harness.client.callTool({
        name: "chat_completion",
        arguments: {
          conversation_id: "thread-1",
          message: "hello",
        },
      });

      expect(first.isError).toBeFalsy();

      const second = await harness.client.callTool({
        name: "chat_completion",
        arguments: {
          conversation_id: "thread-1",
          message: "follow up",
        },
      });

      expect(second.isError).toBeFalsy();
      expect(harness.api.createChatCompletion).toHaveBeenCalledTimes(2);

      const firstRequest = harness.api.createChatCompletion.mock.calls[0]?.[0];
      const secondRequest = harness.api.createChatCompletion.mock.calls[1]?.[0];

      expect(firstRequest.messages).toHaveLength(1);
      expect(secondRequest.messages).toHaveLength(3);

      const list = await harness.client.callTool({ name: "list_conversations", arguments: {} });
      const textBlock = list.content?.[0];
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("expected text tool output");
      }
      expect(textBlock.text).toContain("thread-1");

      const resource = await harness.client.readResource({
        uri: "deepseek://conversations/thread-1",
      });

      const content = resource.contents[0];
      if (!("text" in content) || typeof content.text !== "string") {
        throw new Error("expected text conversation resource");
      }

      const parsed = JSON.parse(content.text);
      expect(parsed.message_count).toBe(4);

      await harness.client.callTool({
        name: "reset_conversation",
        arguments: { conversation_id: "thread-1" },
      });

      const listAfterReset = await harness.client.callTool({
        name: "list_conversations",
        arguments: {},
      });

      const postReset = listAfterReset.content?.[0];
      if (!postReset || postReset.type !== "text") {
        throw new Error("expected text tool output");
      }
      expect(postReset.text).toContain("(no stored conversations)");
    } finally {
      await harness.serverClose();
    }
  });

  it("forwards V4 chat thinking and FIM completion parameters", async () => {
    const harness = await createHarness();

    try {
      const chat = await harness.client.callTool({
        name: "chat_completion",
        arguments: {
          message: "hello",
          model: "deepseek-v4-pro",
          thinking: { type: "enabled" },
          reasoning_effort: "max",
          user_id: "tenant_123",
          max_tokens: 64,
        },
      });

      expect(chat.isError).toBeFalsy();
      expect(harness.api.createChatCompletion).toHaveBeenCalledTimes(1);
      expect(harness.api.createChatCompletion.mock.calls[0]?.[0]).toMatchObject({
        model: "deepseek-v4-pro",
        thinking: { type: "enabled" },
        reasoning_effort: "max",
        user_id: "tenant_123",
        max_tokens: 64,
      });

      const completion = await harness.client.callTool({
        name: "completion",
        arguments: {
          prompt: "def foo():",
          model: "deepseek-v4-pro",
          suffix: "return value",
          max_tokens: 64,
          top_p: 0.7,
          stream: false,
        },
      });

      expect(completion.isError).toBeFalsy();
      expect(harness.api.createCompletion).toHaveBeenCalledTimes(1);
      expect(harness.api.createCompletion.mock.calls[0]?.[0]).toMatchObject({
        prompt: "def foo():",
        model: "deepseek-v4-pro",
        suffix: "return value",
        max_tokens: 64,
        top_p: 0.7,
      });
    } finally {
      await harness.serverClose();
    }
  });

  it("forwards multimodal Chat and Responses inputs without rewriting image parts", async () => {
    const harness = await createHarness();
    const chatMessage = [
      { type: "text", text: "describe" },
      { type: "image_url", image_url: { url: "https://example.com/a.png", detail: "low" } },
    ];
    const responseInput = [
      {
        role: "user",
        content: [
          { type: "input_text", text: "describe" },
          { type: "input_image", file_id: "file-api-test1" },
        ],
      },
    ];

    try {
      const chat = await harness.client.callTool({
        name: "chat_completion",
        arguments: { message: chatMessage },
      });
      const response = await harness.client.callTool({
        name: "create_response",
        arguments: { input: responseInput },
      });

      expect(chat.isError).toBeFalsy();
      expect(response.isError).toBeFalsy();
      expect(harness.api.createChatCompletion.mock.calls[0]?.[0]).toMatchObject({
        model: "deepseek-flash",
        messages: [{ role: "user", content: chatMessage }],
      });
      expect(harness.api.createResponse.mock.calls[0]?.[0]).toMatchObject({
        model: "deepseek-flash",
        input: responseInput,
      });
    } finally {
      await harness.serverClose();
    }
  });

  it("does not let extra_body replace validated top-level generation fields", async () => {
    const harness = await createHarness();

    try {
      await harness.client.callTool({
        name: "chat_completion",
        arguments: {
          message: "safe chat",
          model: "deepseek-flash",
          extra_body: {
            model: "attacker-model",
            messages: [{ role: "user", content: "replaced" }],
            future_parameter: "kept",
          },
        },
      });
      await harness.client.callTool({
        name: "create_response",
        arguments: {
          input: "safe response",
          model: "deepseek-flash",
          extra_body: { model: "attacker-model", input: "replaced" },
        },
      });
      await harness.client.callTool({
        name: "completion",
        arguments: {
          prompt: "safe completion",
          model: "deepseek-v4-pro",
          extra_body: { model: "attacker-model", prompt: "replaced" },
        },
      });

      expect(harness.api.createChatCompletion.mock.calls[0]?.[0]).toMatchObject({
        model: "deepseek-flash",
        messages: [{ role: "user", content: "safe chat" }],
        future_parameter: "kept",
      });
      expect(harness.api.createResponse.mock.calls[0]?.[0]).toMatchObject({
        model: "deepseek-flash",
        input: "safe response",
      });
      expect(harness.api.createCompletion.mock.calls[0]?.[0]).toMatchObject({
        model: "deepseek-v4-pro",
        prompt: "safe completion",
      });
    } finally {
      await harness.serverClose();
    }
  });

  it("forwards Responses API inputs and keeps the raw payload opt-in", async () => {
    const harness = await createHarness();

    try {
      const result = await harness.client.callTool({
        name: "create_response",
        arguments: {
          model: "deepseek-v4-pro",
          input: "hello",
          instructions: "Be concise",
          reasoning: { effort: "low" },
          max_output_tokens: 64,
          stream: true,
        },
      });

      expect(result.isError).toBeFalsy();
      expect(harness.api.createResponse).toHaveBeenCalledTimes(1);
      expect(harness.api.createResponse.mock.calls[0]?.[0]).toMatchObject({
        model: "deepseek-v4-pro",
        input: "hello",
        instructions: "Be concise",
        reasoning: { effort: "low" },
        max_output_tokens: 64,
        stream: true,
      });
      expect(result.content?.[0]).toMatchObject({ type: "text", text: "response-text" });
      expect(result.structuredContent).toMatchObject({
        model: "deepseek-v4-pro",
        status: "completed",
        output_text: "response-text",
      });
      expect((result.structuredContent as Record<string, unknown>)?.raw_response).toBeUndefined();

      const withRaw = await harness.client.callTool({
        name: "create_response",
        arguments: {
          input: "hello",
          include_raw_response: true,
        },
      });
      expect((withRaw.structuredContent as Record<string, unknown>)?.raw_response).toBeDefined();
    } finally {
      await harness.serverClose();
    }
  });

  it("uses the configured default model for Responses API calls", async () => {
    const harness = await createHarness("deepseek-v4-pro");

    try {
      const result = await harness.client.callTool({
        name: "create_response",
        arguments: { input: "hello" },
      });

      expect(result.isError).toBeFalsy();
      expect(harness.api.createResponse.mock.calls[0]?.[0]).toMatchObject({
        model: "deepseek-v4-pro",
      });
    } finally {
      await harness.serverClose();
    }
  });

  it.each([
    ["server_error", true],
    ["invalid_request_error", false],
  ])("marks failed Responses API results as MCP errors for %s", async (errorCode, retryable) => {
    const harness = await createHarness();
    harness.api.createResponse.mockResolvedValueOnce({
      response: {
        id: "resp-failed",
        object: "response",
        created_at: 2,
        status: "failed",
        model: "deepseek-v4-flash",
        output: [],
        error: {
          code: errorCode,
          message: "provider failed",
        },
      },
    });

    try {
      const result = await harness.client.callTool({
        name: "create_response",
        arguments: { input: "hello" },
      });

      expect(result.isError).toBe(true);
      expect(result.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("provider failed"),
      });
      expect(result.structuredContent).toMatchObject({
        status: "failed",
        retryable,
        error: {
          code: errorCode,
          message: "provider failed",
        },
      });
    } finally {
      await harness.serverClose();
    }
  });

  it("calls list_models and get_user_balance", async () => {
    const harness = await createHarness();

    try {
      const models = await harness.client.callTool({ name: "list_models", arguments: {} });
      expect(models.isError).toBeFalsy();
      expect(harness.api.listModels).toHaveBeenCalledTimes(1);

      const balance = await harness.client.callTool({ name: "get_user_balance", arguments: {} });
      expect(balance.isError).toBeFalsy();
      expect(harness.api.getUserBalance).toHaveBeenCalledTimes(1);
    } finally {
      await harness.serverClose();
    }
  });

  it("uploads, lists, retrieves, and deletes DeepSeek files with structured results", async () => {
    const harness = await createHarness();

    try {
      const upload = await harness.client.callTool({
        name: "upload_file",
        arguments: {
          filename: "pixel.png",
          file_data: "iVBORw0KGgo=",
          expires_after_seconds: 3600,
        },
      });
      const list = await harness.client.callTool({
        name: "list_files",
        arguments: { limit: 25, order: "desc", purpose: "user_data" },
      });
      const retrieve = await harness.client.callTool({
        name: "retrieve_file",
        arguments: { file_id: "file-api-test1" },
      });
      const remove = await harness.client.callTool({
        name: "delete_file",
        arguments: { file_id: "file-api-test1" },
      });

      expect(upload.isError).toBeFalsy();
      expect(upload.content[0]).toMatchObject({
        type: "text",
        text: expect.stringContaining("file-api-test1"),
      });
      expect(upload.structuredContent).toMatchObject({
        id: "file-api-test1",
        filename: "pixel.png",
      });
      expect(list.structuredContent).toMatchObject({
        data: [{ id: "file-api-test1" }],
        has_more: false,
      });
      expect(retrieve.structuredContent).toMatchObject({ id: "file-api-test1" });
      expect(remove.structuredContent).toEqual({
        id: "file-api-test1",
        object: "file",
        deleted: true,
      });
      expect(harness.api.uploadFile).toHaveBeenCalledWith({
        filename: "pixel.png",
        fileData: "iVBORw0KGgo=",
        expiresAfterSeconds: 3600,
      });
      expect(harness.api.listFiles).toHaveBeenCalledWith({
        limit: 25,
        order: "desc",
        purpose: "user_data",
      });
      expect(harness.api.retrieveFile).toHaveBeenCalledWith("file-api-test1");
      expect(harness.api.deleteFile).toHaveBeenCalledWith("file-api-test1");
    } finally {
      await harness.serverClose();
    }
  });

  it("keeps raw provider payload opt-in to reduce token bloat", async () => {
    const harness = await createHarness();

    try {
      const withoutRaw = await harness.client.callTool({
        name: "chat_completion",
        arguments: {
          message: "hello",
        },
      });

      expect(withoutRaw.isError).toBeFalsy();
      expect((withoutRaw.structuredContent as Record<string, unknown>)?.raw_response).toBeUndefined();

      const withRaw = await harness.client.callTool({
        name: "chat_completion",
        arguments: {
          message: "hello",
          include_raw_response: true,
        },
      });

      expect(withRaw.isError).toBeFalsy();
      expect((withRaw.structuredContent as Record<string, unknown>)?.raw_response).toBeDefined();
    } finally {
      await harness.serverClose();
    }
  });
});
