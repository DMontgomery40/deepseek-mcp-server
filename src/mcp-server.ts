import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { ConversationStore } from "./conversation-store.js";
import { DeepSeekApiClient, DeepSeekApiError } from "./deepseek/client.js";
import {
  ChatCompletionToolInput,
  CompletionToolInput,
  chatCompletionToolInputSchema,
  completionToolInputSchema,
  emptyToolInputSchema,
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

const SERVER_VERSION = "0.4.0";
const RETRYABLE_DEEPSEEK_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504]);

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
        "Primary DeepSeek chat tool for single-turn and multi-turn generation. Provide either `message` (simple single user turn) or `messages` (full chat history); if both are provided, `messages` is used. Use `conversation_id` to persist context across calls and `clear_conversation=true` to reset stored state before sending the next turn. Set `include_raw_response=true` only for debugging, because it returns the full provider payload and increases token usage.",
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
        const includeRawResponse = normalizedInput.include_raw_response;

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

        const structuredContent: Record<string, unknown> = {
          model: result.response.model,
          conversation_id: conversationId ?? null,
          response_text: responseText,
          reasoning_content: reasoning ?? null,
          tool_calls: toolCalls,
          finish_reason: choice?.finish_reason ?? null,
          usage: result.response.usage ?? null,
          fallback: result.fallback ?? null,
          stream_chunk_count: result.streamChunkCount ?? null,
        };

        if (includeRawResponse) {
          structuredContent.raw_response = result.response;
        }

        return {
          content: [{ type: "text", text: summary }],
          structuredContent,
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
        "DeepSeek text/FIM completion tool for prompt-completion workflows. Use this when you need raw completion text instead of chat message formatting. Supports the same generation controls as the provider completion endpoint and can aggregate streamed output. Set `include_raw_response=true` only when you need the full provider payload for debugging.",
      inputSchema: completionToolInputSchema,
    },
    async (input) => {
      try {
        const normalizedInput = input as CompletionToolInput;
        const request = buildCompletionRequest(normalizedInput, options.defaultModel);
        const result = await options.client.createCompletion(request);
        const choice = result.response.choices[0];
        const includeRawResponse = normalizedInput.include_raw_response;

        const structuredContent: Record<string, unknown> = {
          model: result.response.model,
          text: choice?.text ?? "",
          finish_reason: choice?.finish_reason ?? null,
          usage: result.response.usage ?? null,
          stream_chunk_count: result.streamChunkCount ?? null,
        };

        if (includeRawResponse) {
          structuredContent.raw_response = result.response;
        }

        return {
          content: [
            {
              type: "text",
              text: choice?.text || "(no completion text returned)",
            },
          ],
          structuredContent,
        };
      } catch (error) {
        return makeToolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "list_models",
    {
      description:
        "List available DeepSeek models for model selection and validation. This tool takes no parameters. Use it before passing an explicit model ID to generation tools.",
      inputSchema: emptyToolInputSchema,
      annotations: {
        readOnlyHint: true,
      },
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
      description:
        "Return the current DeepSeek account balance and availability status. This tool takes no parameters and is read-only. Use it for account health checks when diagnosing provider-side failures.",
      inputSchema: emptyToolInputSchema,
      annotations: {
        readOnlyHint: true,
      },
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
      description:
        "Delete stored in-memory chat history for a `conversation_id`. Use this when you want to keep the same ID but start a fresh thread. This only affects server-side memory in the current MCP process.",
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
      description:
        "List all conversation IDs currently stored in this MCP process memory. This tool takes no parameters and does not call the DeepSeek API. Useful for debugging conversation persistence behavior.",
      inputSchema: emptyToolInputSchema,
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
  structuredContent: {
    error_type: "deepseek_api_error" | "tool_execution_error";
    status: number | null;
    message: string;
    retryable: boolean;
    suggestion: string;
  };
} {
  if (error instanceof DeepSeekApiError) {
    const retryable = isRetryableDeepSeekError(error.status);
    const suggestion = getDeepSeekErrorSuggestion(error.status);

    return {
      isError: true,
      content: [
        {
          type: "text",
          text: error.status
            ? `DeepSeek API error (${error.status}): ${error.message}. ${suggestion}`
            : `DeepSeek API error: ${error.message}. ${suggestion}`,
        },
      ],
      structuredContent: {
        error_type: "deepseek_api_error",
        status: error.status ?? null,
        message: error.message,
        retryable,
        suggestion,
      },
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text", text: `Tool execution failed: ${message}. Check input schema and required fields.` }],
    structuredContent: {
      error_type: "tool_execution_error",
      status: null,
      message,
      retryable: false,
      suggestion: "Validate the tool arguments against the published schema and retry.",
    },
  };
}

function isRetryableDeepSeekError(status: number | undefined): boolean {
  if (status === undefined) {
    return true;
  }

  return RETRYABLE_DEEPSEEK_STATUS_CODES.has(status);
}

function getDeepSeekErrorSuggestion(status: number | undefined): string {
  if (status === undefined) {
    return "Retry the request and verify network connectivity.";
  }

  if (status === 401 || status === 403) {
    return "Verify DEEPSEEK_API_KEY and endpoint permissions.";
  }

  if (status === 402) {
    return "Check account balance or billing status.";
  }

  if (status === 429) {
    return "Rate limit reached; retry with backoff.";
  }

  if (status >= 500) {
    return "Provider service issue; retry with backoff.";
  }

  if (status >= 400) {
    return "Review request fields and argument types.";
  }

  return "Retry the request.";
}
