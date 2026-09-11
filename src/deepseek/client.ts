import {
  ChatCompletionExecutionResult,
  CompletionExecutionResult,
  DeepSeekChatCompletionRequest,
  DeepSeekChatCompletionResponse,
  DeepSeekCompletionRequest,
  DeepSeekCompletionResponse,
  DeepSeekFile,
  DeepSeekFileDeletion,
  DeepSeekFileList,
  DeepSeekListFilesRequest,
  DeepSeekListModelsResponse,
  DeepSeekResponse,
  DeepSeekResponseRequest,
  DeepSeekToolCall,
  DeepSeekUploadFileRequest,
  DeepSeekUsage,
  DeepSeekUserBalanceResponse,
  ResponseExecutionResult,
} from "./types.js";

export interface DeepSeekApiClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  userAgent?: string;
  fetchFn?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_USER_AGENT = "deepseek-mcp-server/1.0.0";
export class DeepSeekApiError extends Error {
  public readonly status?: number;
  public readonly payload?: unknown;

  constructor(message: string, options?: { status?: number; payload?: unknown; cause?: unknown }) {
    super(message);
    this.name = "DeepSeekApiError";
    this.status = options?.status;
    this.payload = options?.payload;

    if (options?.cause !== undefined) {
      Object.defineProperty(this, "cause", {
        value: options.cause,
        enumerable: false,
        writable: true,
        configurable: true,
      });
    }
  }
}

interface RequestOptions {
  method: "DELETE" | "GET" | "POST";
  path: string;
  jsonBody?: Record<string, unknown>;
  body?: BodyInit;
  query?: URLSearchParams;
  stream?: boolean;
  baseUrlOverride?: string;
}

interface CompletionDeltaToolCall {
  index?: number;
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

export class DeepSeekApiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly userAgent: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: DeepSeekApiClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async createChatCompletion(request: DeepSeekChatCompletionRequest): Promise<ChatCompletionExecutionResult> {
    if (request.stream) {
      const chunks = await this.requestSseJson<unknown>({
        method: "POST",
        path: "/chat/completions",
        jsonBody: request as Record<string, unknown>,
        stream: true,
      });

      return {
        response: aggregateChatCompletionChunks(chunks, String(request.model)),
        streamChunkCount: chunks.length,
      };
    }

    const response = await this.requestJson<DeepSeekChatCompletionResponse>({
      method: "POST",
      path: "/chat/completions",
      jsonBody: request as Record<string, unknown>,
      stream: false,
    });

    return { response };
  }

  async createCompletion(request: DeepSeekCompletionRequest): Promise<CompletionExecutionResult> {
    if (request.stream) {
      const chunks = await this.requestSseJson<unknown>({
        method: "POST",
        path: "/beta/completions",
        jsonBody: request as Record<string, unknown>,
        stream: true,
      });

      return {
        response: aggregateCompletionChunks(chunks, String(request.model)),
        streamChunkCount: chunks.length,
      };
    }

    const response = await this.requestJson<DeepSeekCompletionResponse>({
      method: "POST",
      path: "/beta/completions",
      jsonBody: request as Record<string, unknown>,
      stream: false,
    });

    return { response };
  }

  async createResponse(request: DeepSeekResponseRequest): Promise<ResponseExecutionResult> {
    if (request.stream) {
      const events = await this.requestSseJson<unknown>({
        method: "POST",
        path: "/responses",
        jsonBody: request as Record<string, unknown>,
        stream: true,
      });

      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (
          isObject(event) &&
          ["response.completed", "response.incomplete", "response.failed"].includes(String(event.type)) &&
          isObject(event.response)
        ) {
          return {
            response: event.response as unknown as DeepSeekResponse,
            streamEventCount: events.length,
          };
        }
      }

      throw new DeepSeekApiError("DeepSeek Responses API stream ended without a final response event", {
        payload: events,
      });
    }

    const response = await this.requestJson<DeepSeekResponse>({
      method: "POST",
      path: "/responses",
      jsonBody: request as Record<string, unknown>,
      stream: false,
    });

    return { response };
  }

  async listModels(): Promise<DeepSeekListModelsResponse> {
    return this.requestJson<DeepSeekListModelsResponse>({
      method: "GET",
      path: "/models",
      stream: false,
    });
  }

  async getUserBalance(): Promise<DeepSeekUserBalanceResponse> {
    return this.requestJson<DeepSeekUserBalanceResponse>({
      method: "GET",
      path: "/user/balance",
      stream: false,
    });
  }

  async uploadFile(request: DeepSeekUploadFileRequest): Promise<DeepSeekFile> {
    const { bytes, mediaType } = decodeImageData(request.fileData);
    const form = new FormData();
    form.append("purpose", "user_data");
    form.append("file", new Blob([bytes], { type: mediaType }), request.filename);

    if (request.expiresAfterSeconds !== undefined) {
      form.append("expires_after[anchor]", "created_at");
      form.append("expires_after[seconds]", String(request.expiresAfterSeconds));
    }

    return this.requestJson<DeepSeekFile>({
      method: "POST",
      path: "/files",
      body: form,
    });
  }

  async listFiles(request: DeepSeekListFilesRequest = {}): Promise<DeepSeekFileList> {
    const query = new URLSearchParams();

    if (request.after !== undefined) {
      query.set("after", request.after);
    }
    if (request.limit !== undefined) {
      query.set("limit", String(request.limit));
    }
    if (request.order !== undefined) {
      query.set("order", request.order);
    }
    if (request.purpose !== undefined) {
      query.set("purpose", request.purpose);
    }

    return this.requestJson<DeepSeekFileList>({
      method: "GET",
      path: "/files",
      query,
    });
  }

  async retrieveFile(fileId: string): Promise<DeepSeekFile> {
    return this.requestJson<DeepSeekFile>({
      method: "GET",
      path: `/files/${encodeURIComponent(fileId)}`,
    });
  }

  async deleteFile(fileId: string): Promise<DeepSeekFileDeletion> {
    return this.requestJson<DeepSeekFileDeletion>({
      method: "DELETE",
      path: `/files/${encodeURIComponent(fileId)}`,
    });
  }

  private async requestJson<T>(options: RequestOptions): Promise<T> {
    const response = await this.send(options);

    if (!response.ok) {
      throw await this.parseApiError(response);
    }

    const payload = await response.json();
    return payload as T;
  }

  private async requestSseJson<T>(options: RequestOptions): Promise<T[]> {
    const response = await this.send(options);

    if (!response.ok) {
      throw await this.parseApiError(response);
    }

    if (!response.body) {
      throw new DeepSeekApiError("DeepSeek API returned an empty stream response", {
        status: response.status,
      });
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    const chunks: T[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");

      let splitIndex = buffer.indexOf("\n\n");
      while (splitIndex !== -1) {
        const eventBlock = buffer.slice(0, splitIndex).trim();
        buffer = buffer.slice(splitIndex + 2);

        const parsedChunk = parseSseEventBlock<T>(eventBlock);
        if (parsedChunk !== undefined) {
          chunks.push(parsedChunk);
        }

        splitIndex = buffer.indexOf("\n\n");
      }
    }

    const finalChunk = parseSseEventBlock<T>(buffer.trim());
    if (finalChunk !== undefined) {
      chunks.push(finalChunk);
    }

    return chunks;
  }

  private async send(options: RequestOptions): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: options.stream ? "text/event-stream" : "application/json",
        "User-Agent": this.userAgent,
      };
      if (options.jsonBody !== undefined) {
        headers["Content-Type"] = "application/json";
      }

      const response = await this.fetchFn(this.resolveUrl(options.path, options.baseUrlOverride, options.query), {
        method: options.method,
        headers,
        body: options.jsonBody !== undefined ? JSON.stringify(options.jsonBody) : options.body,
        signal: controller.signal,
      });

      return response;
    } catch (error) {
      if (error instanceof DeepSeekApiError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new DeepSeekApiError(
          `DeepSeek API request timed out after ${this.timeoutMs}ms`,
          { cause: error },
        );
      }

      throw new DeepSeekApiError("Failed to call DeepSeek API", { cause: error });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async parseApiError(response: Response): Promise<DeepSeekApiError> {
    let payload: unknown;

    try {
      payload = await response.json();
    } catch {
      try {
        payload = await response.text();
      } catch {
        payload = undefined;
      }
    }

    const message = extractErrorMessage(payload) || `DeepSeek API request failed with status ${response.status}`;

    return new DeepSeekApiError(message, {
      status: response.status,
      payload,
    });
  }

  private resolveUrl(path: string, baseUrlOverride?: string, query?: URLSearchParams): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const baseUrl = baseUrlOverride ?? this.baseUrl;
    const queryString = query?.toString();
    return `${baseUrl}${normalizedPath}${queryString ? `?${queryString}` : ""}`;
  }

}

function decodeImageData(fileData: string): { bytes: Uint8Array<ArrayBuffer>; mediaType: string } {
  const dataUrlMatch = /^data:(image\/(?:jpeg|png|gif|webp));base64,([a-zA-Z0-9+/]+={0,2})$/.exec(fileData);
  const payload = dataUrlMatch?.[2] ?? fileData;
  const decoded = Buffer.from(payload, "base64");
  const detectedMediaType = detectImageMediaType(decoded);

  if (!detectedMediaType) {
    throw new DeepSeekApiError("Unsupported image format; expected JPEG, PNG, GIF, or WebP");
  }

  if (dataUrlMatch?.[1] && dataUrlMatch[1] !== detectedMediaType) {
    throw new DeepSeekApiError(
      `Image data URL declares ${dataUrlMatch[1]} but contains ${detectedMediaType}`,
    );
  }

  const bytes = new Uint8Array(decoded.byteLength);
  bytes.set(decoded);

  return { bytes, mediaType: detectedMediaType };
}

function detectImageMediaType(bytes: Uint8Array): string | undefined {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }

  if (bytes.length >= 6) {
    const signature = Buffer.from(bytes.subarray(0, 6)).toString("ascii");
    if (signature === "GIF87a" || signature === "GIF89a") {
      return "image/gif";
    }
  }

  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
    Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  return undefined;
}

function normalizeBaseUrl(input: string): string {
  return input.endsWith("/") ? input.slice(0, -1) : input;
}

function parseSseEventBlock<T>(block: string): T | undefined {
  if (!block) {
    return undefined;
  }

  const lines = block.split("\n");
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) {
    return undefined;
  }

  const data = dataLines.join("\n").trim();
  if (data === "[DONE]") {
    return undefined;
  }

  try {
    return JSON.parse(data) as T;
  } catch (error) {
    throw new DeepSeekApiError("Failed to parse DeepSeek stream payload", {
      payload: data,
      cause: error,
    });
  }
}

function aggregateChatCompletionChunks(chunks: unknown[], requestedModel: string): DeepSeekChatCompletionResponse {
  let id = "";
  let model = requestedModel;
  let created = Math.floor(Date.now() / 1000);
  let finishReason: string | null = null;
  let content = "";
  let reasoningContent = "";
  let usage: DeepSeekUsage | undefined;
  const toolCalls: DeepSeekToolCall[] = [];

  for (const chunk of chunks) {
    if (!isObject(chunk)) {
      continue;
    }

    if (typeof chunk.id === "string") {
      id = chunk.id;
    }

    if (typeof chunk.model === "string") {
      model = chunk.model;
    }

    if (typeof chunk.created === "number") {
      created = chunk.created;
    }

    if (isObject(chunk.usage)) {
      usage = chunk.usage as DeepSeekUsage;
    }

    const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
    const choice = choices[0];
    if (!isObject(choice)) {
      continue;
    }

    if (typeof choice.finish_reason === "string") {
      finishReason = choice.finish_reason;
    }

    const delta = isObject(choice.delta)
      ? choice.delta
      : isObject(choice.message)
        ? choice.message
        : undefined;

    if (!delta) {
      continue;
    }

    if (typeof delta.content === "string") {
      content += delta.content;
    }

    if (typeof delta.reasoning_content === "string") {
      reasoningContent += delta.reasoning_content;
    }

    const deltaToolCalls = Array.isArray(delta.tool_calls)
      ? (delta.tool_calls as CompletionDeltaToolCall[])
      : [];

    mergeDeltaToolCalls(toolCalls, deltaToolCalls);
  }

  if (!id) {
    id = `chatcmpl-${Date.now()}`;
  }

  return {
    id,
    object: "chat.completion",
    created,
    model,
    choices: [
      {
        index: 0,
        finish_reason: finishReason,
        message: {
          role: "assistant",
          content: content || null,
          ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
      },
    ],
    ...(usage ? { usage } : {}),
  };
}

function mergeDeltaToolCalls(target: DeepSeekToolCall[], deltaCalls: CompletionDeltaToolCall[]): void {
  for (const deltaCall of deltaCalls) {
    const index = Number.isInteger(deltaCall.index) ? (deltaCall.index as number) : target.length;

    if (!target[index]) {
      target[index] = {
        id: deltaCall.id,
        type: "function",
        function: {
          name: deltaCall.function?.name ?? "",
          arguments: deltaCall.function?.arguments ?? "",
        },
      };
      continue;
    }

    const existing = target[index];

    if (deltaCall.id) {
      existing.id = deltaCall.id;
    }

    if (deltaCall.function?.name) {
      existing.function.name += deltaCall.function.name;
    }

    if (deltaCall.function?.arguments) {
      existing.function.arguments += deltaCall.function.arguments;
    }
  }
}

function aggregateCompletionChunks(chunks: unknown[], requestedModel: string): DeepSeekCompletionResponse {
  let id = "";
  let model = requestedModel;
  let created = Math.floor(Date.now() / 1000);
  let finishReason: string | null = null;
  let text = "";
  let usage: DeepSeekUsage | undefined;

  for (const chunk of chunks) {
    if (!isObject(chunk)) {
      continue;
    }

    if (typeof chunk.id === "string") {
      id = chunk.id;
    }

    if (typeof chunk.model === "string") {
      model = chunk.model;
    }

    if (typeof chunk.created === "number") {
      created = chunk.created;
    }

    if (isObject(chunk.usage)) {
      usage = chunk.usage as DeepSeekUsage;
    }

    const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
    if (!isObject(choice)) {
      continue;
    }

    if (typeof choice.text === "string") {
      text += choice.text;
    }

    if (typeof choice.finish_reason === "string") {
      finishReason = choice.finish_reason;
    }
  }

  if (!id) {
    id = `cmpl-${Date.now()}`;
  }

  return {
    id,
    object: "text_completion",
    created,
    model,
    choices: [
      {
        index: 0,
        text,
        finish_reason: finishReason,
      },
    ],
    ...(usage ? { usage } : {}),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractErrorMessage(payload: unknown): string {
  if (typeof payload === "string") {
    return payload;
  }

  if (!isObject(payload)) {
    return "DeepSeek API request failed";
  }

  const errorValue = payload.error;
  if (isObject(errorValue) && typeof errorValue.message === "string") {
    return errorValue.message;
  }

  if (typeof payload.message === "string") {
    return payload.message;
  }

  return "DeepSeek API request failed";
}
