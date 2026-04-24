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
    listModels: ReturnType<typeof vi.fn>;
    getUserBalance: ReturnType<typeof vi.fn>;
  };
}

async function createHarness(): Promise<Harness> {
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
    listModels: vi.fn(async () => ({
      object: "list",
      data: [
        { id: "deepseek-v4-flash", object: "model" },
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
    defaultModel: "deepseek-v4-flash",
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
        "get_user_balance",
        "list_conversations",
        "list_models",
        "reset_conversation",
      ]);

      expect(toolsByName.get("list_models")?.inputSchema).toMatchObject({ type: "object" });
      expect(toolsByName.get("get_user_balance")?.inputSchema).toMatchObject({ type: "object" });
      expect(toolsByName.get("list_conversations")?.inputSchema).toMatchObject({ type: "object" });
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
          max_tokens: 64,
        },
      });

      expect(chat.isError).toBeFalsy();
      expect(harness.api.createChatCompletion).toHaveBeenCalledTimes(1);
      expect(harness.api.createChatCompletion.mock.calls[0]?.[0]).toMatchObject({
        model: "deepseek-v4-pro",
        thinking: { type: "enabled" },
        reasoning_effort: "max",
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
