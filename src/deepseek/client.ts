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
import {
  MAX_DEEPSEEK_FILE_BASE64_CHARS,
  MAX_DEEPSEEK_FILE_BYTES,
  MAX_DEEPSEEK_INLINE_IMAGE_BYTES,
  MAX_DEEPSEEK_JSON_BODY_BYTES,
  inspectCanonicalBase64,
} from "./image-data.js";

export interface DeepSeekApiClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  userAgent?: string;
  fetchFn?: typeof fetch;
}

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_TIMEOUT_MS = 120000;
const DEFAULT_USER_AGENT = "deepseek-mcp-server/1.4.1";
export class DeepSeekApiError extends Error {
  public readonly status?: number;
  public readonly payload?: unknown;

  constructor(
    message: string,
    options?: { status?: number; payload?: unknown; cause?: unknown },
  ) {
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
  signal?: AbortSignal;
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

  async createChatCompletion(
    request: DeepSeekChatCompletionRequest,
    signal?: AbortSignal,
  ): Promise<ChatCompletionExecutionResult> {
    validateGenerationImages(
      request.messages.flatMap((message) =>
        Array.isArray(message.content) ? message.content : [],
      ),
    );
    const beta =
      request.messages.some((message) => message.prefix === true) ||
      request.tools?.some((tool) => tool.function.strict === true);
    const path = beta ? "/beta/chat/completions" : "/chat/completions";
    if (request.stream) {
      const chunks = await this.requestSseJson<unknown>({
        method: "POST",
        signal,
        path,
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
      signal,
      path,
      jsonBody: request as Record<string, unknown>,
      stream: false,
    });

    return { response };
  }

  async createCompletion(
    request: DeepSeekCompletionRequest,
    signal?: AbortSignal,
  ): Promise<CompletionExecutionResult> {
    if (request.stream) {
      const chunks = await this.requestSseJson<unknown>({
        method: "POST",
        signal,
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
      signal,
      path: "/beta/completions",
      jsonBody: request as Record<string, unknown>,
      stream: false,
    });

    return { response };
  }

  async createResponse(
    request: DeepSeekResponseRequest,
    signal?: AbortSignal,
  ): Promise<ResponseExecutionResult> {
    validateResponseHistory(request);
    validateGenerationImages(
      Array.isArray(request.input)
        ? request.input.flatMap((item) => {
            if (Array.isArray(item.content)) return item.content;
            if (Array.isArray(item.output)) return item.output;
            return [];
          })
        : [],
    );
    if (request.stream) {
      const events = await this.requestSseJson<unknown>({
        method: "POST",
        signal,
        path: "/responses",
        jsonBody: request as Record<string, unknown>,
        stream: true,
      });

      for (let index = events.length - 1; index >= 0; index -= 1) {
        const event = events[index];
        if (
          isObject(event) &&
          [
            "response.completed",
            "response.incomplete",
            "response.failed",
          ].includes(String(event.type)) &&
          isObject(event.response)
        ) {
          return {
            response: redactCredential(
              event.response,
              this.apiKey,
            ) as DeepSeekResponse,
            streamEventCount: events.length,
          };
        }
      }

      throw new DeepSeekApiError(
        "DeepSeek Responses API stream ended without a final response event",
        {
          payload: events,
        },
      );
    }

    const response = await this.requestJson<DeepSeekResponse>({
      method: "POST",
      signal,
      path: "/responses",
      jsonBody: request as Record<string, unknown>,
      stream: false,
    });

    return {
      response: redactCredential(response, this.apiKey) as DeepSeekResponse,
    };
  }

  async listModels(signal?: AbortSignal): Promise<DeepSeekListModelsResponse> {
    return this.requestJson<DeepSeekListModelsResponse>({
      method: "GET",
      signal,
      path: "/models",
      stream: false,
    });
  }

  async getUserBalance(
    signal?: AbortSignal,
  ): Promise<DeepSeekUserBalanceResponse> {
    return this.requestJson<DeepSeekUserBalanceResponse>({
      method: "GET",
      signal,
      path: "/user/balance",
      stream: false,
    });
  }

  async uploadFile(
    request: DeepSeekUploadFileRequest,
    signal?: AbortSignal,
  ): Promise<DeepSeekFile> {
    const { bytes, mediaType } = decodeImageData(request.fileData);
    const form = new FormData();
    form.append("purpose", "user_data");
    form.append(
      "file",
      new Blob([bytes], { type: mediaType }),
      request.filename,
    );

    if (request.expiresAfterSeconds !== undefined) {
      form.append("expires_after[anchor]", "created_at");
      form.append(
        "expires_after[seconds]",
        String(request.expiresAfterSeconds),
      );
    }

    return this.requestJson<DeepSeekFile>({
      method: "POST",
      signal,
      path: "/files",
      body: form,
    });
  }

  async listFiles(
    request: DeepSeekListFilesRequest = {},
    signal?: AbortSignal,
  ): Promise<DeepSeekFileList> {
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
      signal,
      path: "/files",
      query,
    });
  }

  async retrieveFile(
    fileId: string,
    signal?: AbortSignal,
  ): Promise<DeepSeekFile> {
    return this.requestJson<DeepSeekFile>({
      method: "GET",
      signal,
      path: `/files/${encodeURIComponent(fileId)}`,
    });
  }

  async deleteFile(
    fileId: string,
    signal?: AbortSignal,
  ): Promise<DeepSeekFileDeletion> {
    return this.requestJson<DeepSeekFileDeletion>({
      method: "DELETE",
      signal,
      path: `/files/${encodeURIComponent(fileId)}`,
    });
  }

  private async requestJson<T>(options: RequestOptions): Promise<T> {
    return this.send(
      options,
      async (response) => response.json() as Promise<T>,
    );
  }

  private async requestSseJson<T>(options: RequestOptions): Promise<T[]> {
    return this.send(options, (response) => this.readSseJson<T>(response));
  }

  private async readSseJson<T>(response: Response): Promise<T[]> {
    if (!response.body) {
      throw new DeepSeekApiError(
        "DeepSeek API returned an empty stream response",
        {
          status: response.status,
        },
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    let buffer = "";
    const chunks: T[] = [];

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        let boundary = /\r?\n\r?\n/.exec(buffer);
        while (boundary !== null) {
          const eventBlock = buffer.slice(0, boundary.index).trim();
          buffer = buffer.slice(boundary.index + boundary[0].length);

          const parsedChunk = parseSseEventBlock<T>(eventBlock);
          if (parsedChunk === SSE_DONE) {
            return chunks;
          }
          if (parsedChunk !== undefined) {
            chunks.push(parsedChunk);
          }

          boundary = /\r?\n\r?\n/.exec(buffer);
        }
      }

      buffer += decoder.decode();
      const finalChunk = parseSseEventBlock<T>(buffer.trim());
      if (finalChunk !== undefined && finalChunk !== SSE_DONE) {
        chunks.push(finalChunk);
      }

      return chunks;
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  private async send<T>(
    options: RequestOptions,
    consume: (response: Response) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    const cancel = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", cancel, { once: true });
    if (options.signal?.aborted) cancel();

    try {
      controller.signal.throwIfAborted();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: options.stream ? "text/event-stream" : "application/json",
        "User-Agent": this.userAgent,
      };
      if (options.jsonBody !== undefined) {
        headers["Content-Type"] = "application/json";
      }

      const body =
        options.jsonBody !== undefined
          ? JSON.stringify(options.jsonBody)
          : options.body;
      if (
        typeof body === "string" &&
        Buffer.byteLength(body, "utf8") > MAX_DEEPSEEK_JSON_BODY_BYTES
      ) {
        throw new DeepSeekApiError(
          "DeepSeek JSON request exceeds 48 MiB; use Files API references for large images",
        );
      }

      const response = await this.fetchFn(
        this.resolveUrl(options.path, options.baseUrlOverride, options.query),
        {
          method: options.method,
          headers,
          body,
          signal: controller.signal,
        },
      );

      if (!response.ok) {
        throw await this.parseApiError(response);
      }
      const result = await consume(response);
      controller.signal.throwIfAborted();
      return result;
    } catch (error) {
      if (error instanceof DeepSeekApiError) {
        throw new DeepSeekApiError(
          String(redactCredential(error.message, this.apiKey)),
          {
            status: error.status,
            payload: redactCredential(error.payload, this.apiKey),
          },
        );
      }

      if (options.signal?.aborted) {
        throw new DeepSeekApiError("DeepSeek API request cancelled", {
          cause: error,
        });
      }

      if (
        controller.signal.aborted ||
        (error instanceof Error && error.name === "AbortError")
      ) {
        throw new DeepSeekApiError(
          `DeepSeek API request timed out after ${this.timeoutMs}ms`,
          { cause: error },
        );
      }

      throw new DeepSeekApiError("Failed to call DeepSeek API", {
        cause: error,
      });
    } finally {
      clearTimeout(timeoutId);
      options.signal?.removeEventListener("abort", cancel);
    }
  }

  private async parseApiError(response: Response): Promise<DeepSeekApiError> {
    const text = await response.text();
    let payload: unknown = text;

    try {
      payload = JSON.parse(text);
    } catch {
      // Non-JSON upstream errors still contain useful diagnostic text.
    }

    const message =
      extractErrorMessage(payload) ||
      `DeepSeek API request failed with status ${response.status}`;

    return new DeepSeekApiError(message, {
      status: response.status,
      payload,
    });
  }

  private resolveUrl(
    path: string,
    baseUrlOverride?: string,
    query?: URLSearchParams,
  ): string {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const configuredBase = baseUrlOverride ?? this.baseUrl;
    const baseUrl = normalizedPath.startsWith("/beta/")
      ? configuredBase.replace(/\/(?:v1|beta)$/, "")
      : configuredBase;
    const queryString = query?.toString();
    return `${baseUrl}${normalizedPath}${queryString ? `?${queryString}` : ""}`;
  }
}

function validateGenerationImages(parts: unknown[]): void {
  const images = parts.filter(
    (part) =>
      isObject(part) &&
      ["image_url", "input_image", "file"].includes(String(part.type)),
  );
  if (images.length > 600) {
    throw new DeepSeekApiError(
      "DeepSeek allows at most 600 images per request",
    );
  }
  for (const image of images) {
    if (!isObject(image)) continue;
    const reference =
      typeof image.file_data === "string"
        ? image.file_data
        : typeof image.image_url === "string"
          ? image.image_url
          : isObject(image.image_url)
            ? image.image_url.url
            : undefined;
    if (typeof reference !== "string" || !reference.startsWith("data:"))
      continue;
    const payload = reference.slice(reference.indexOf(",") + 1);
    if (
      payload.length > Math.ceil(MAX_DEEPSEEK_INLINE_IMAGE_BYTES / 3) * 4 ||
      (inspectCanonicalBase64(payload)?.decodedBytes ?? Infinity) >
        MAX_DEEPSEEK_INLINE_IMAGE_BYTES
    ) {
      throw new DeepSeekApiError(
        "Inline images may not exceed 32 MiB; use the Files API for larger images",
      );
    }
  }
}

function validateResponseHistory(request: DeepSeekResponseRequest): void {
  const names =
    request.tools
      ?.filter((tool) => ["function", "custom"].includes(String(tool.type)))
      .map((tool) => tool.name) ?? [];
  if (new Set(names).size !== names.length) {
    throw new DeepSeekApiError("Responses tool names must be unique");
  }
  if (!Array.isArray(request.input)) return;
  for (const kind of ["function", "custom_tool"]) {
    const calls = request.input.filter((item) => item.type === `${kind}_call`);
    const outputs = request.input.filter(
      (item) => item.type === `${kind}_call_output`,
    );
    const callIds = calls.map((item) => item.call_id);
    const outputIds = outputs.map((item) => item.call_id);
    if (
      new Set(callIds).size !== callIds.length ||
      new Set(outputIds).size !== outputIds.length
    ) {
      throw new DeepSeekApiError(
        "Responses call IDs must be unique for each call/output kind",
      );
    }
    if (callIds.some((id) => !outputIds.includes(id))) {
      throw new DeepSeekApiError(
        "Each Responses tool call requires a matching output in input history",
      );
    }
  }
}

function decodeImageData(fileData: string): {
  bytes: Uint8Array<ArrayBuffer>;
  mediaType: string;
} {
  const dataUrlMatch =
    /^data:(image\/(?:jpeg|png|gif|webp));base64,([a-zA-Z0-9+/]+={0,2})$/.exec(
      fileData,
    );
  const payload = dataUrlMatch?.[2] ?? fileData;
  if (payload.length > MAX_DEEPSEEK_FILE_BASE64_CHARS) {
    throw new DeepSeekApiError(
      "Image exceeds DeepSeek's 64 MiB Files API limit",
    );
  }

  const inspection = inspectCanonicalBase64(payload);
  if (!inspection) {
    throw new DeepSeekApiError("Invalid base64 image data");
  }
  if (inspection.decodedBytes > MAX_DEEPSEEK_FILE_BYTES) {
    throw new DeepSeekApiError(
      "Image exceeds DeepSeek's 64 MiB Files API limit",
    );
  }

  const decoded = Buffer.from(payload, "base64");
  const detectedMediaType = detectImageMediaType(decoded);

  if (!detectedMediaType) {
    throw new DeepSeekApiError(
      "Unsupported image format; expected JPEG, PNG, GIF, or WebP",
    );
  }

  if (dataUrlMatch?.[1] && dataUrlMatch[1] !== detectedMediaType) {
    throw new DeepSeekApiError(
      `Image data URL declares ${dataUrlMatch[1]} but contains ${detectedMediaType}`,
    );
  }

  const bytes = new Uint8Array(
    decoded.buffer as ArrayBuffer,
    decoded.byteOffset,
    decoded.byteLength,
  );

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

  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
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

const SSE_DONE = Symbol("SSE_DONE");

function parseSseEventBlock<T>(block: string): T | typeof SSE_DONE | undefined {
  if (!block) {
    return undefined;
  }

  const lines = block.split(/\r?\n/);
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) {
    return undefined;
  }

  const data = dataLines.join("\n").trim();
  if (data === "[DONE]") {
    return SSE_DONE;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch (error) {
    throw new DeepSeekApiError("Failed to parse DeepSeek stream payload", {
      payload: data,
      cause: error,
    });
  }
  if (
    isObject(payload) &&
    payload.error !== undefined &&
    payload.error !== null
  ) {
    throw new DeepSeekApiError(extractErrorMessage(payload), { payload });
  }
  return payload as T;
}

function aggregateChatCompletionChunks(
  chunks: unknown[],
  requestedModel: string,
): DeepSeekChatCompletionResponse {
  let id = "";
  let model = requestedModel;
  let created = Math.floor(Date.now() / 1000);
  let finishReason: string | null = null;
  let content = "";
  let reasoningContent = "";
  let usage: DeepSeekUsage | undefined;
  let fingerprint: string | undefined;
  let logprobs: Record<string, unknown> | undefined;
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

    if (typeof chunk.system_fingerprint === "string")
      fingerprint = chunk.system_fingerprint;

    if (isObject(chunk.usage)) {
      usage = chunk.usage as DeepSeekUsage;
    }

    const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
    const choice = choices[0];
    if (!isObject(choice)) {
      continue;
    }

    if (isObject(choice.logprobs))
      logprobs = mergeLogprobChunks(logprobs, choice.logprobs);

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
        ...(logprobs ? { logprobs } : {}),
        message: {
          role: "assistant",
          content: content || null,
          ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
      },
    ],
    ...(usage ? { usage } : {}),
    ...(fingerprint ? { system_fingerprint: fingerprint } : {}),
  };
}

function mergeDeltaToolCalls(
  target: DeepSeekToolCall[],
  deltaCalls: CompletionDeltaToolCall[],
): void {
  for (const deltaCall of deltaCalls) {
    const index = Number.isInteger(deltaCall.index)
      ? (deltaCall.index as number)
      : target.length;

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

function aggregateCompletionChunks(
  chunks: unknown[],
  requestedModel: string,
): DeepSeekCompletionResponse {
  let id = "";
  let model = requestedModel;
  let created = Math.floor(Date.now() / 1000);
  let finishReason: string | null = null;
  let text = "";
  let usage: DeepSeekUsage | undefined;
  let fingerprint: string | undefined;
  let logprobs: Record<string, unknown> | undefined;

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

    if (typeof chunk.system_fingerprint === "string")
      fingerprint = chunk.system_fingerprint;

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

    if (isObject(choice.logprobs))
      logprobs = mergeLogprobChunks(logprobs, choice.logprobs);

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
        ...(logprobs ? { logprobs } : {}),
      },
    ],
    ...(usage ? { usage } : {}),
    ...(fingerprint ? { system_fingerprint: fingerprint } : {}),
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

function redactCredential(value: unknown, key: string): unknown {
  if (!key) return value;
  if (typeof value === "string") return value.split(key).join("[REDACTED]");
  if (Array.isArray(value))
    return value.map((item) => redactCredential(item, key));
  if (isObject(value))
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [
        name,
        redactCredential(item, key),
      ]),
    );
  return value;
}

function mergeLogprobChunks(
  previous: Record<string, unknown> | undefined,
  current: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...previous };
  for (const [key, value] of Object.entries(current)) {
    merged[key] = Array.isArray(value)
      ? [...(Array.isArray(merged[key]) ? merged[key] : []), ...value]
      : value;
  }
  return merged;
}
