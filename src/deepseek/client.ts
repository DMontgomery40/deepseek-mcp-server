import {
  ChatCompletionExecutionResult,
  CompletionExecutionResult,
  DeepSeekChatCompletionRequest,
  DeepSeekChatCompletionResponse,
  DeepSeekCompletionRequest,
  DeepSeekCompletionResponse,
  DeepSeekListModelsResponse,
  DeepSeekToolCall,
  DeepSeekUsage,
  DeepSeekUserBalanceResponse,
  FallbackMetadata,
} from "./types.js";

export interface DeepSeekApiClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  userAgent?: string;
  fetchFn?: typeof fetch;
  enableReasonerFallback?: boolean;
  fallbackModel?: string;
}

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_USER_AGENT = "deepseek-mcp-server/0.3.0";
const RETRIABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504]);

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
  method: "GET" | "POST";
  path: string;
  body?: Record<string, unknown>;
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
  private readonly enableReasonerFallback: boolean;
  private readonly fallbackModel: string;

  constructor(options: DeepSeekApiClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.fetchFn = options.fetchFn ?? fetch;
    this.enableReasonerFallback = options.enableReasonerFallback ?? true;
    this.fallbackModel = options.fallbackModel ?? "deepseek-chat";
  }

  async createChatCompletion(request: DeepSeekChatCompletionRequest): Promise<ChatCompletionExecutionResult> {
    try {
      return await this.createChatCompletionNoFallback(request);
    } catch (error) {
      if (!this.shouldFallback(request, error)) {
        throw error;
      }

      const fallbackRequest: DeepSeekChatCompletionRequest = {
        ...request,
        model: this.fallbackModel,
      };
      const fallback = await this.createChatCompletionNoFallback(fallbackRequest);

      const fallbackMetadata: FallbackMetadata = {
        fromModel: String(request.model),
        toModel: this.fallbackModel,
        reason: extractErrorMessage(error),
      };

      return {
        ...fallback,
        fallback: fallbackMetadata,
      };
    }
  }

  private async createChatCompletionNoFallback(
    request: DeepSeekChatCompletionRequest,
  ): Promise<ChatCompletionExecutionResult> {
    if (request.stream) {
      const chunks = await this.requestSseJson<unknown>({
        method: "POST",
        path: "/chat/completions",
        body: request as Record<string, unknown>,
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
      body: request as Record<string, unknown>,
      stream: false,
    });

    return { response };
  }

  async createCompletion(request: DeepSeekCompletionRequest): Promise<CompletionExecutionResult> {
    try {
      return await this.createCompletionInternal(request);
    } catch (error) {
      if (!this.shouldRetryCompletionOnBeta(error)) {
        throw error;
      }

      return this.createCompletionInternal(request, this.buildBetaBaseUrl());
    }
  }

  private async createCompletionInternal(
    request: DeepSeekCompletionRequest,
    baseUrlOverride?: string,
  ): Promise<CompletionExecutionResult> {
    if (request.stream) {
      const chunks = await this.requestSseJson<unknown>({
        method: "POST",
        path: "/completions",
        body: request as Record<string, unknown>,
        stream: true,
        baseUrlOverride,
      });

      return {
        response: aggregateCompletionChunks(chunks, String(request.model)),
        streamChunkCount: chunks.length,
      };
    }

    const response = await this.requestJson<DeepSeekCompletionResponse>({
      method: "POST",
      path: "/completions",
      body: request as Record<string, unknown>,
      stream: false,
      baseUrlOverride,
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

  private shouldFallback(request: DeepSeekChatCompletionRequest, error: unknown): boolean {
    if (!this.enableReasonerFallback) {
      return false;
    }

    const sourceModel = String(request.model);
    if (sourceModel !== "deepseek-reasoner") {
      return false;
    }

    if (sourceModel === this.fallbackModel) {
      return false;
    }

    if (!(error instanceof DeepSeekApiError)) {
      return true;
    }

    if (error.status === undefined) {
      return true;
    }

    return RETRIABLE_STATUS_CODES.has(error.status);
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
      const response = await this.fetchFn(this.resolveUrl(options.path, options.baseUrlOverride), {
        method: options.method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          Accept: options.stream ? "text/event-stream" : "application/json",
          "User-Agent": this.userAgent,
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
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

  private resolveUrl(path: string, baseUrlOverride?: string): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const baseUrl = baseUrlOverride ?? this.baseUrl;
    return `${baseUrl}${normalizedPath}`;
  }

  private buildBetaBaseUrl(): string {
    try {
      const parsed = new URL(this.baseUrl);
      parsed.pathname = "/beta";
      return parsed.toString().replace(/\/$/, "");
    } catch {
      return "https://api.deepseek.com/beta";
    }
  }

  private shouldRetryCompletionOnBeta(error: unknown): boolean {
    if (!(error instanceof DeepSeekApiError)) {
      return false;
    }

    if (error.status !== 400) {
      return false;
    }

    const message = (error.message ?? "").toLowerCase();
    return message.includes("completions api is only available when using beta api");
  }
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
