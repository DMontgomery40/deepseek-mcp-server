import { McpServer, ResourceTemplate } from "@modelcontextprotocol/server";
import { z } from "zod";

import { ConversationStore } from "./conversation-store.js";
import { DeepSeekApiClient, DeepSeekApiError } from "./deepseek/client.js";
import {
  ChatCompletionToolInput,
  CompletionToolInput,
  FileIdToolInput,
  ListFilesToolInput,
  ResponseToolInput,
  UploadFileToolInput,
  chatCompletionToolInputSchema,
  completionToolInputSchema,
  emptyToolInputSchema,
  fileIdToolInputSchema,
  listFilesToolInputSchema,
  resetConversationToolInputSchema,
  responseToolInputSchema,
  uploadFileToolInputSchema,
} from "./deepseek/schemas.js";
import {
  DeepSeekChatCompletionRequest,
  DeepSeekChatMessage,
  DeepSeekCompletionRequest,
  DeepSeekResponseOutputItem,
  DeepSeekResponseRequest,
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
    description: "V4.1 Chat Completions API with text/images, thinking, tool calls, JSON output, and streaming",
  },
  {
    endpoint: "/responses",
    method: "POST",
    tool: "create_response",
    description: "Native V4.1 Responses API with text/images, reasoning, function tools, web search, and streaming",
  },
  {
    endpoint: "/beta/completions",
    method: "POST",
    tool: "completion",
    description: "V4.1 Flash FIM Completions API",
  },
  {
    endpoint: "/models",
    method: "GET",
    tool: "list_models",
    description: "List available DeepSeek models",
  },
  {
    endpoint: "/files",
    method: "POST",
    tool: "upload_file",
    description: "Upload an image for reuse by file_id",
  },
  {
    endpoint: "/files",
    method: "GET",
    tool: "list_files",
    description: "List uploaded DeepSeek image files",
  },
  {
    endpoint: "/files/{file_id}",
    method: "GET",
    tool: "retrieve_file",
    description: "Retrieve uploaded image file metadata",
  },
  {
    endpoint: "/files/{file_id}",
    method: "DELETE",
    tool: "delete_file",
    description: "Delete an uploaded image file",
  },
  {
    endpoint: "/user/balance",
    method: "GET",
    tool: "get_user_balance",
    description: "Retrieve account balance",
  },
] as const;

const SERVER_VERSION = "1.0.0";
const RETRYABLE_DEEPSEEK_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504]);
const RETRYABLE_RESPONSE_ERROR_CODES = new Set([
  "rate_limit_exceeded",
  "server_error",
  "service_unavailable",
  "timeout",
  "overloaded_error",
]);
const NON_RETRYABLE_RESPONSE_ERROR_CODES = new Set([
  "authentication_error",
  "invalid_request_error",
  "permission_error",
]);

const rawResponseOutputSchema = z.record(z.string(), z.unknown()).optional();

const errorOutputShape = {
  error_type: z.enum(["deepseek_api_error", "tool_execution_error"]).optional(),
  status: z.number().int().nullable().optional(),
  message: z.string().optional(),
  retryable: z.boolean().optional(),
  suggestion: z.string().optional(),
};

const chatOutputSchema = z
  .object({
    model: z.string(),
    conversation_id: z.string().nullable(),
    response_text: z.string(),
    reasoning_content: z.string().nullable(),
    tool_calls: z.array(z.record(z.string(), z.unknown())),
    finish_reason: z.string().nullable(),
    usage: z.unknown().nullable(),
    stream_chunk_count: z.number().int().nullable(),
    raw_response: rawResponseOutputSchema,
  })
  .partial()
  .extend(errorOutputShape)
  .passthrough();

const completionOutputSchema = z
  .object({
    model: z.string(),
    text: z.string(),
    finish_reason: z.string().nullable(),
    usage: z.unknown().nullable(),
    stream_chunk_count: z.number().int().nullable(),
    raw_response: rawResponseOutputSchema,
  })
  .partial()
  .extend(errorOutputShape)
  .passthrough();

const responseOutputSchema = z
  .object({
    model: z.string(),
    status: z.string(),
    output_text: z.string(),
    reasoning_text: z.string().nullable(),
    function_calls: z.array(z.record(z.string(), z.unknown())),
    usage: z.unknown().nullable(),
    error: z.unknown().nullable(),
    incomplete_details: z.unknown().nullable(),
    stream_event_count: z.number().int().nullable(),
    retryable: z.boolean().optional(),
    suggestion: z.string().optional(),
    raw_response: rawResponseOutputSchema,
  })
  .partial()
  .extend({
    ...errorOutputShape,
    status: z.union([z.string(), z.number().int(), z.null()]).optional(),
  })
  .passthrough();

const modelListOutputSchema = z
  .object({
    object: z.string(),
    data: z.array(
      z
        .object({
          id: z.string(),
          object: z.string(),
          owned_by: z.string().optional(),
          created: z.number().optional(),
        })
        .passthrough(),
    ),
  })
  .partial()
  .extend(errorOutputShape)
  .passthrough();

const balanceOutputSchema = z
  .object({
    is_available: z.boolean(),
    balance_infos: z.array(
      z.object({
        currency: z.string(),
        total_balance: z.string(),
        granted_balance: z.string(),
        topped_up_balance: z.string(),
      }),
    ),
  })
  .partial()
  .extend(errorOutputShape)
  .passthrough();

const fileMetadataSchema = z
  .object({
    id: z.string(),
    object: z.literal("file"),
    bytes: z.number().int().nonnegative(),
    created_at: z.number().int(),
    filename: z.string(),
    purpose: z.literal("user_data"),
    expires_at: z.number().int().optional(),
  })
  .passthrough();

const fileOutputSchema = fileMetadataSchema.partial().extend(errorOutputShape).passthrough();

const fileListOutputSchema = z
  .object({
    object: z.literal("list"),
    data: z.array(fileMetadataSchema),
    first_id: z.string().optional(),
    last_id: z.string().optional(),
    has_more: z.boolean(),
  })
  .partial()
  .extend(errorOutputShape)
  .passthrough();

const fileDeletionOutputSchema = z
  .object({
    id: z.string(),
    object: z.literal("file"),
    deleted: z.boolean(),
  })
  .partial()
  .extend(errorOutputShape)
  .passthrough();

const resetConversationOutputSchema = z
  .object({
    conversation_id: z.string(),
    removed: z.boolean(),
  })
  .partial()
  .extend(errorOutputShape)
  .passthrough();

const listConversationsOutputSchema = z
  .object({
    conversation_ids: z.array(z.string()),
    count: z.number().int().nonnegative(),
  })
  .partial()
  .extend(errorOutputShape)
  .passthrough();

export function createDeepSeekMcpServer(options: DeepSeekMcpServerOptions): McpServer {
  const server = new McpServer(
    {
      name: "deepseek-mcp-server",
      version: options.version ?? SERVER_VERSION,
    },
    {
      cacheHints: {
        "tools/list": { ttlMs: 3_600_000, cacheScope: "public" },
        "prompts/list": { ttlMs: 3_600_000, cacheScope: "public" },
        "resources/list": { ttlMs: 0, cacheScope: "private" },
        "resources/templates/list": { ttlMs: 3_600_000, cacheScope: "public" },
        "resources/read": { ttlMs: 0, cacheScope: "private" },
        "server/discover": { ttlMs: 3_600_000, cacheScope: "public" },
      },
    },
  );

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
      cacheHint: { ttlMs: 3_600_000, cacheScope: "public" },
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
      cacheHint: { ttlMs: 0, cacheScope: "private" },
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
              current_models: ["deepseek-flash"],
              legacy_model_aliases: ["deepseek-v4-flash", "deepseek-v4-flash-vision-exp"],
              phasing_out_models: ["deepseek-v4-pro"],
              conversation_count: options.conversations.listConversationIds().length,
              supports_streaming: true,
              supports_thinking_mode: true,
              supports_vision: true,
              supports_files_api: true,
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
      cacheHint: { ttlMs: 30_000, cacheScope: "private" },
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
      cacheHint: { ttlMs: 0, cacheScope: "private" },
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
        "Primary DeepSeek V4.1 chat tool for text, images, and multi-turn generation. Defaults to `deepseek-flash`. Provide either `message` (a text string or text/image/file content parts) or `messages` (full chat history); if both are provided, `messages` is used. Images may use an HTTP(S) URL, supported base64 data URL, or Files API `file_id`. Thinking is enabled by default; use `reasoning_effort` for current effort controls. Use `conversation_id` for explicit in-memory context. Set `include_raw_response=true` only for provider-payload debugging.",
      inputSchema: chatCompletionToolInputSchema,
      outputSchema: chatOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
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
        "DeepSeek FIM completion tool for prompt/suffix fill-in-the-middle workflows. Defaults to `deepseek-flash` in non-thinking mode. Use this when you need raw completion text instead of chat message formatting. Set `include_raw_response=true` only when you need the full provider payload for debugging.",
      inputSchema: completionToolInputSchema,
      outputSchema: completionOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
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
    "create_response",
    {
      description:
        "Create a stateless DeepSeek V4.1 response using the OpenAI-compatible Responses API. Defaults to `deepseek-flash` and accepts text, image URLs, base64 images, and Files API `file_id` inputs. Use `reasoning.effort` for thinking control, `tools` for function or server-side web-search tools, and `stream=true` for semantic SSE aggregation. Send full input history for multi-turn work. Set `include_raw_response=true` only for provider-payload debugging.",
      inputSchema: responseToolInputSchema,
      outputSchema: responseOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const normalizedInput = input as ResponseToolInput;
        const request = buildResponseRequest(normalizedInput, options.defaultModel);
        const result = await options.client.createResponse(request);
        const outputText = collectResponseContent(result.response.output, "output_text");
        const reasoningText = collectResponseContent(result.response.output, "reasoning_text");
        const functionCalls = result.response.output.filter((item) => item.type === "function_call");
        const responseFailed = result.response.status === "failed";
        const responseErrorMessage =
          result.response.error && typeof result.response.error.message === "string"
            ? result.response.error.message
            : "DeepSeek returned a failed response";
        const responseRetryable = getResponseErrorRetryability(result.response.error);

        const summary = [
          responseFailed
            ? `DeepSeek Responses API failed: ${responseErrorMessage}`
            : outputText || "(no response text returned)",
          reasoningText ? `\nReasoning:\n${reasoningText}` : undefined,
          functionCalls.length > 0
            ? `\nFunction calls returned by model: ${JSON.stringify(functionCalls, null, 2)}`
            : undefined,
        ]
          .filter(Boolean)
          .join("\n");

        const structuredContent: Record<string, unknown> = {
          model: result.response.model,
          status: result.response.status,
          output_text: outputText,
          reasoning_text: reasoningText || null,
          function_calls: functionCalls,
          usage: result.response.usage ?? null,
          error: result.response.error ?? null,
          incomplete_details: result.response.incomplete_details ?? null,
          stream_event_count: result.streamEventCount ?? null,
        };

        if (normalizedInput.include_raw_response) {
          structuredContent.raw_response = result.response;
        }

        if (responseFailed) {
          if (responseRetryable !== undefined) {
            structuredContent.retryable = responseRetryable;
          }
          structuredContent.suggestion = responseRetryable
            ? "Transient provider failure; retry with backoff."
            : "Review the provider error and request fields before retrying.";
        }

        return {
          ...(responseFailed ? { isError: true as const } : {}),
          content: [{ type: "text", text: summary }],
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
      outputSchema: modelListOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
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
      outputSchema: balanceOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
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
    "upload_file",
    {
      description:
        "Upload a JPEG, PNG, GIF, or WebP image to DeepSeek and return a reusable `file_id`. Supply base64 image data directly; server-local file paths are intentionally not accepted. Optional expiry is 3,600 to 2,592,000 seconds.",
      inputSchema: uploadFileToolInputSchema,
      outputSchema: fileOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const normalizedInput = input as UploadFileToolInput;
        const file = await options.client.uploadFile({
          filename: normalizedInput.filename,
          fileData: normalizedInput.file_data,
          expiresAfterSeconds: normalizedInput.expires_after_seconds,
        });
        return {
          content: [
            {
              type: "text",
              text: `Uploaded ${file.filename} as ${file.id} (${file.bytes} bytes).`,
            },
          ],
          structuredContent: file as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return makeToolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "list_files",
    {
      description:
        "List images uploaded to the DeepSeek Files API. Supports cursor pagination, creation-time order, and the `user_data` purpose filter.",
      inputSchema: listFilesToolInputSchema,
      outputSchema: fileListOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const files = await options.client.listFiles(input as ListFilesToolInput);
        return {
          content: [
            {
              type: "text",
              text:
                files.data.length > 0
                  ? files.data.map((file) => `${file.id}\t${file.filename}\t${file.bytes} bytes`).join("\n")
                  : "(no files returned)",
            },
          ],
          structuredContent: files as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return makeToolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "retrieve_file",
    {
      description: "Retrieve metadata for one DeepSeek Files API image by `file_id`.",
      inputSchema: fileIdToolInputSchema,
      outputSchema: fileOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const { file_id } = input as FileIdToolInput;
        const file = await options.client.retrieveFile(file_id);
        return {
          content: [{ type: "text", text: JSON.stringify(file, null, 2) }],
          structuredContent: file as unknown as Record<string, unknown>,
        };
      } catch (error) {
        return makeToolErrorResult(error);
      }
    },
  );

  server.registerTool(
    "delete_file",
    {
      description:
        "Delete one uploaded DeepSeek image by `file_id`. This permanently removes that provider-side file reference.",
      inputSchema: fileIdToolInputSchema,
      outputSchema: fileDeletionOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const { file_id } = input as FileIdToolInput;
        const deleted = await options.client.deleteFile(file_id);
        return {
          content: [
            {
              type: "text",
              text: deleted.deleted ? `Deleted ${deleted.id}.` : `${deleted.id} was not deleted.`,
            },
          ],
          structuredContent: deleted as unknown as Record<string, unknown>,
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
      outputSchema: resetConversationOutputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
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
      outputSchema: listConversationsOutputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
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
    "reasoning_effort",
    "user_id",
  ];
  const requestRecord = request as Record<string, unknown>;

  for (const field of optionalFields) {
    const value = input[field];
    if (value !== undefined) {
      requestRecord[field] = value;
    }
  }

  mergeExtraBody(request as Record<string, unknown>, input.extra_body, [
    "model",
    "messages",
    ...optionalFields,
  ]);

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
    "stream",
    "logprobs",
    "echo",
    "stop",
    "presence_penalty",
    "frequency_penalty",
  ];
  const requestRecord = request as Record<string, unknown>;

  for (const field of optionalFields) {
    const value = input[field];
    if (value !== undefined) {
      requestRecord[field] = value;
    }
  }

  mergeExtraBody(request as Record<string, unknown>, input.extra_body, [
    "model",
    "prompt",
    ...optionalFields,
  ]);

  return request;
}

function buildResponseRequest(input: ResponseToolInput, defaultModel: string): DeepSeekResponseRequest {
  const request: DeepSeekResponseRequest = {
    model: input.model ?? defaultModel,
  };

  const optionalFields: (keyof ResponseToolInput)[] = [
    "input",
    "instructions",
    "reasoning",
    "max_output_tokens",
    "stream",
    "temperature",
    "top_p",
    "text",
    "tools",
    "tool_choice",
    "top_logprobs",
    "user",
  ];
  const requestRecord = request as Record<string, unknown>;

  for (const field of optionalFields) {
    const value = input[field];
    if (value !== undefined) {
      requestRecord[field] = value;
    }
  }

  mergeExtraBody(request as Record<string, unknown>, input.extra_body, [
    "model",
    ...optionalFields,
  ]);

  return request;
}

function mergeExtraBody(
  request: Record<string, unknown>,
  extraBody: Record<string, unknown> | undefined,
  reservedFields: readonly PropertyKey[],
): void {
  if (!extraBody) {
    return;
  }

  const reserved = new Set(reservedFields.map(String));
  for (const [key, value] of Object.entries(extraBody)) {
    if (!reserved.has(key)) {
      request[key] = value;
    }
  }
}

function collectResponseContent(
  output: DeepSeekResponseOutputItem[],
  contentType: "output_text" | "reasoning_text",
): string {
  return output
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === contentType && typeof content.text === "string")
    .map((content) => content.text)
    .join("");
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

function getResponseErrorRetryability(error: Record<string, unknown> | null | undefined): boolean | undefined {
  const code = typeof error?.code === "string" ? error.code : undefined;
  if (!code) {
    return undefined;
  }

  if (RETRYABLE_RESPONSE_ERROR_CODES.has(code)) {
    return true;
  }

  if (NON_RETRYABLE_RESPONSE_ERROR_CODES.has(code)) {
    return false;
  }

  return undefined;
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
