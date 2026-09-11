export type McpTransportMode = "stdio" | "streamable-http";

export interface RuntimeConfig {
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  deepseekRequestTimeoutMs: number;
  defaultModel: string;
  transport: McpTransportMode;
  httpHost: string;
  httpPort: number;
  httpPath: string;
  httpAllowedOrigins: string[];
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
    defaultModel: env.DEEPSEEK_DEFAULT_MODEL ?? "deepseek-flash",
    transport,
    httpHost: env.MCP_HTTP_HOST ?? "127.0.0.1",
    httpPort: parsePort(env.MCP_HTTP_PORT, 3001),
    httpPath: normalizePath(env.MCP_HTTP_PATH ?? "/mcp"),
    httpAllowedOrigins: parseCsv(env.MCP_HTTP_ALLOWED_ORIGINS),
    conversationMaxMessages: parsePositiveInt(env.CONVERSATION_MAX_MESSAGES, 200),
  };
}

function parseCsv(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parsePositiveInt(value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return defaultValue;
  }

  return parsed;
}

function parsePort(value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return defaultValue;
  }

  return parsed;
}

function normalizePath(path: string): string {
  if (!path.startsWith("/")) {
    return `/${path}`;
  }

  return path;
}
