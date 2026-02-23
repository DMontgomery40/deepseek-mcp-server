import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { ConversationStore } from "./conversation-store.js";
import { DeepSeekApiClient, DeepSeekApiError } from "./deepseek/client.js";
import {
  ChatCompletionToolInput,
  CompletionToolInput,
  chatCompletionToolInputSchema,
  completionToolInputSchema,
  resetConversationToolInputSchema,
} from "./deepseek/schemas.js";
import {
  DeepSeekChatCompletionRequest,
  DeepSeekChatMessage,
  DeepSeekCompletionRequest,
} from "./deepseek/types.js";

export interface DeepSeekMcpServerOptions {
  client: DeepSeekApiClient;
  conversations: ConversationStore;
  defaultModel: string;
  version?: string;
}

const ENDPOINT_MATRIX = [
  {
    endpoint: "/chat/completions",
    method: "POST",
    tool: "chat_completion",
    description: "Chat Completions API (streaming and non-streaming)",
  },
  {
    endpoint: "/completions",
    method: "POST",
    tool: "completion",
    description: "Text/FIM Completions API (streaming and non-streaming)",
  },
  {
    endpoint: "/models",
    method: "GET",
    tool: "list_models",
    description: "List available DeepSeek models",
  },
  {
    endpoint: "/user/balance",
    method: "GET",
    tool: "get_user_balance",
    description: "Retrieve account balance",
  },
] as const;

const SERVER_VERSION = "0.3.0";

export function createDeepSeekMcpServer(options: DeepSeekMcpServerOptions): McpServer {
  const server = new McpServer({
    name: "deepseek-mcp-server",
    version: options.version ?? SERVER_VERSION,
  });

  registerResources(server, options);
  registerPrompts(server, options);
  registerTools(server, options);

  return server;
}

function registerResources(server: McpServer, options: DeepSeekMcpServerOptions): void {
  server.registerResource(
    "deepseek-api-endpoints",
    "deepseek://api/endpoints",
    {
      description: "DeepSeek endpoint/tool mapping exposed by this MCP server",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify({ endpoints: ENDPOINT_MATRIX }, null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    "deepseek-runtime",
    "deepseek://api/runtime",
    {
      description: "Runtime metadata for this MCP process",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              server_name: "deepseek-mcp-server",
              server_version: options.version ?? SERVER_VERSION,
              default_model: options.defaultModel,
              conversation_count: options.conversations.listConversationIds().length,
              supports_streaming: true,
              supports_reasoner_fallback: true,
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  server.registerResource(
    "deepseek-models-live",
    "deepseek://api/models/live",
    {
      description: "Live model list from DeepSeek /models endpoint",
      mimeType: "application/json",
    },
    async (uri) => {
      const models = await options.client.listModels();
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(models, null, 2),
          },
        ],
      };
    },
  );

  const conversationTemplate = new ResourceTemplate("deepseek://conversations/{conversationId}", {
    list: async () => ({
      resources: options.conversations.listConversationIds().map((conversationId) => ({
        uri: `deepseek://conversations/${encodeURIComponent(conversationId)}`,
        name: `Conversation ${conversationId}`,
        description: "Persisted messages for chat_completion",
      })),
    }),
  });

  server.registerResource(
    "deepseek-conversation",
    conversationTemplate,
    {
      description: "Read stored messages for a specific conversation_id",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const raw = variables.conversationId;
      const conversationId = Array.isArray(raw) ? raw[0] : String(raw ?? "");

      const messages = options.conversations.get(decodeURIComponent(conversationId));
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(
              {
                conversation_id: decodeURIComponent(conversationId),
                message_count: messages.length,
                messages,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}

function registerPrompts(server: McpServer, options: DeepSeekMcpServerOptions): void {
  server.registerPrompt(
    "deepseek_chat_starter",
    {
      description: "Create a reusable starter prompt for DeepSeek chat_completion",
      argsSchema: {
        task: z.string().min(1),
        style: z.string().optional(),
        model: z.string().optional(),
      },
    },
    ({ task, style, model }) => {
      const selectedModel = model ?? options.defaultModel;
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                `Use model: ${selectedModel}`,
                style ? `Style constraints: ${style}` : undefined,
                `Task: ${task}`,
              ]
                .filter(Boolean)
                .join("\n"),
            },
          },
        ],
      };
    },
  );
}

function registerTools(server: McpServer, options: DeepSeekMcpServerOptions): void {
  server.registerTool(
    "chat_completion",
    {
      description:
        "Call DeepSeek POST /chat/completions with support for streaming, reasoning output, tool calls, and optional conversation persistence.",
      inputSchema: chatCompletionToolInputSchema,
    },
    async (input) => {
      try {
        const normalizedInput = input as ChatCompletionToolInput;

        const conversationId = normalizedInput.conversation_id;
        if (conversationId && normalizedInput.clear_conversation) {
          options.conversations.clear(conversationId);
        }

        const newMessages = normalizeInputMessages(normalizedInput);
        const existingHistory = conversationId ? options.conversations.get(conversationId) : [];
        const outboundMessages = conversationId ? [...existingHistory, ...newMessages] : newMessages;

        const request = buildChatCompletionRequest(normalizedInput, outboundMessages, options.defaultModel);
        const result = await options.client.createChatCompletion(request);

        const choice = result.response.choices[0];
        const assistantMessage = choice?.message;

        if (conversationId && assistantMessage) {
          options.conversations.set(conversationId, [
            ...outboundMessages,
            {
              role: "assistant",
              content: assistantMessage.content,
              reasoning_content: assistantMessage.reasoning_content,
              tool_calls: assistantMessage.tool_calls,
            },
          ]);
        }

        const responseText = assistantMessage?.content ?? "";
        const reasoning = assistantMessage?.reasoning_content;
        const toolCalls = assistantMessage?.tool_calls ?? [];

        const summary = [
          result.fallback
            ? `Fallback used: ${result.fallback.fromModel} -> ${result.fallback.toModel}`
            : undefined,
          responseText || "(no assistant content returned)",
          reasoning ? "\nReasoning:\n" + reasoning : undefined,
          toolCalls.length > 0 ? "\nTool calls returned by model: " + JSON.stringify(toolCalls, null, 2) : undefined,
        ]
          .filter(Boolean)
          .join("\n");

        return {
          content: [{ type: "text", text: summary }],
          structuredContent: {
            model: result.response.model,
            conversation_id: conversationId ?? null,
            response_text: responseText,
            reasoning_content: reasoning ?? null,
            tool_calls: toolCalls,
            finish_reason: choice?.finish_reason ?? null,
            usage: result.response.usage ?? null,
            fallback: result.fallback ?? null,
            stream_chunk_count: result.streamChunkCount ?? null,
            raw_response: result.response,
          },
        };
      } catch (error) {
        return makeToolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "completion",
    {
      description:
        "Call DeepSeek POST /completions for text/FIM completion workloads, including streaming support.",
      inputSchema: completionToolInputSchema,
    },
    async (input) => {
      try {
        const normalizedInput = input as CompletionToolInput;
        const request = buildCompletionRequest(normalizedInput, options.defaultModel);
        const result = await options.client.createCompletion(request);
        const choice = result.response.choices[0];

        return {
          content: [
            {
              type: "text",
              text: choice?.text || "(no completion text returned)",
            },
          ],
          structuredContent: {
            model: result.response.model,
            text: choice?.text ?? "",
            finish_reason: choice?.finish_reason ?? null,
            usage: result.response.usage ?? null,
            stream_chunk_count: result.streamChunkCount ?? null,
            raw_response: result.response,
          },
        };
      } catch (error) {
        return makeToolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "list_models",
    {
      description: "Call DeepSeek GET /models",
    },
    async () => {
      try {
        const models = await options.client.listModels();
        return {
          content: [
            {
              type: "text",
              text: models.data.map((model) => model.id).join("\n") || "(no models returned)",
            },
          ],
          structuredContent: models as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return makeToolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "get_user_balance",
    {
      description: "Call DeepSeek GET /user/balance",
    },
    async () => {
      try {
        const balance = await options.client.getUserBalance();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(balance, null, 2),
            },
          ],
          structuredContent: balance as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return makeToolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "reset_conversation",
    {
      description: "Delete stored conversation history by conversation_id",
      inputSchema: resetConversationToolInputSchema,
      annotations: {
        idempotentHint: true,
      },
    },
    async ({ conversation_id }) => {
      const deleted = options.conversations.clear(conversation_id);
      return {
        content: [
          {
            type: "text",
            text: deleted
              ? `Conversation \"${conversation_id}\" was removed.`
              : `Conversation \"${conversation_id}\" did not exist.`,
          },
        ],
        structuredContent: {
          conversation_id,
          removed: deleted,
        },
      };
    },
  );

  server.registerTool(
    "list_conversations",
    {
      description: "List all currently stored conversation IDs",
      annotations: {
        readOnlyHint: true,
      },
    },
    async () => {
      const ids = options.conversations.listConversationIds();
      return {
        content: [
          {
            type: "text",
            text: ids.length > 0 ? ids.join("\n") : "(no stored conversations)",
          },
        ],
        structuredContent: {
          conversation_ids: ids,
          count: ids.length,
        },
      };
    },
  );
}

function normalizeInputMessages(input: ChatCompletionToolInput): DeepSeekChatMessage[] {
  if (input.messages && input.messages.length > 0) {
    return input.messages as DeepSeekChatMessage[];
  }

  if (input.message) {
    return [{ role: "user", content: input.message }];
  }

  throw new Error("Either `message` or `messages` must be provided");
}

function buildChatCompletionRequest(
  input: ChatCompletionToolInput,
  messages: DeepSeekChatMessage[],
  defaultModel: string,
): DeepSeekChatCompletionRequest {
  const request: DeepSeekChatCompletionRequest = {
    model: input.model ?? defaultModel,
    messages,
  };

  const optionalFields: (keyof ChatCompletionToolInput)[] = [
    "frequency_penalty",
    "max_tokens",
    "max_completion_tokens",
    "presence_penalty",
    "response_format",
    "stop",
    "stream",
    "stream_options",
    "temperature",
    "top_p",
    "tools",
    "tool_choice",
    "logprobs",
    "top_logprobs",
    "thinking",
    "modalities",
    "audio",
  ];
  const requestRecord = request as Record<string, unknown>;

  for (const field of optionalFields) {
    const value = input[field];
    if (value !== undefined) {
      requestRecord[field] = value;
    }
  }

  if (input.extra_body) {
    Object.assign(request, input.extra_body);
  }

  return request;
}

function buildCompletionRequest(
  input: CompletionToolInput,
  defaultModel: string,
): DeepSeekCompletionRequest {
  const request: DeepSeekCompletionRequest = {
    model: input.model ?? defaultModel,
    prompt: input.prompt,
  };

  const optionalFields: (keyof CompletionToolInput)[] = [
    "suffix",
    "max_tokens",
    "temperature",
    "top_p",
    "n",
    "stream",
    "logprobs",
    "echo",
    "stop",
    "presence_penalty",
    "frequency_penalty",
    "best_of",
  ];
  const requestRecord = request as Record<string, unknown>;

  for (const field of optionalFields) {
    const value = input[field];
    if (value !== undefined) {
      requestRecord[field] = value;
    }
  }

  if (input.extra_body) {
    Object.assign(request, input.extra_body);
  }

  return request;
}

function makeToolErrorResult(error: unknown): {
  isError: true;
  content: [{ type: "text"; text: string }];
} {
  if (error instanceof DeepSeekApiError) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: error.status
            ? `DeepSeek API error (${error.status}): ${error.message}`
            : `DeepSeek API error: ${error.message}`,
        },
      ],
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text", text: `Tool execution failed: ${message}` }],
  };
}
