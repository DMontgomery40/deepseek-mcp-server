export type McpTransportMode = "stdio" | "streamable-http";

export interface RuntimeConfig {
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  deepseekRequestTimeoutMs: number;
  defaultModel: string;
  enableReasonerFallback: boolean;
  fallbackModel: string;
  transport: McpTransportMode;
  httpHost: string;
  httpPort: number;
  httpPath: string;
  httpStatefulSession: boolean;
  conversationMaxMessages: number;
}

export function loadRuntimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const deepseekApiKey = env.DEEPSEEK_API_KEY;
  if (!deepseekApiKey) {
    throw new Error("DEEPSEEK_API_KEY environment variable is required");
  }

  const transportRaw = (env.MCP_TRANSPORT ?? "stdio").trim().toLowerCase();
  const transport = transportRaw === "streamable-http" ? "streamable-http" : "stdio";

  return {
    deepseekApiKey,
    deepseekBaseUrl: env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    deepseekRequestTimeoutMs: parsePositiveInt(env.DEEPSEEK_REQUEST_TIMEOUT_MS, 120000),
    defaultModel: env.DEEPSEEK_DEFAULT_MODEL ?? "deepseek-chat",
    enableReasonerFallback: parseBoolean(env.DEEPSEEK_ENABLE_REASONER_FALLBACK, true),
    fallbackModel: env.DEEPSEEK_FALLBACK_MODEL ?? "deepseek-chat",
    transport,
    httpHost: env.MCP_HTTP_HOST ?? "127.0.0.1",
    httpPort: parsePort(env.MCP_HTTP_PORT, 3001),
    httpPath: normalizePath(env.MCP_HTTP_PATH ?? "/mcp"),
    httpStatefulSession: parseBoolean(env.MCP_HTTP_STATEFUL_SESSION, false),
    conversationMaxMessages: parsePositiveInt(env.CONVERSATION_MAX_MESSAGES, 200),
  };
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "n", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

function parsePort(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return fallback;
  }

  return parsed;
}

function normalizePath(path: string): string {
  if (!path.startsWith("/")) {
    return `/${path}`;
  }

  return path;
}
