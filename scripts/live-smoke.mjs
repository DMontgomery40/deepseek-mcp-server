#!/usr/bin/env node
import { ConversationStore } from "../build/conversation-store.js";
import { DeepSeekApiClient } from "../build/deepseek/client.js";
import { createDeepSeekMcpServer } from "../build/mcp-server.js";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error("DEEPSEEK_API_KEY is required for live smoke tests");
  process.exit(2);
}

const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";
const timeoutMs = Number(process.env.DEEPSEEK_REQUEST_TIMEOUT_MS || 120000);

const client = new DeepSeekApiClient({
  apiKey,
  baseUrl,
  timeoutMs,
});

const endpointResults = {};

async function runEndpoint(name, fn) {
  try {
    const started = Date.now();
    const summary = await fn();
    endpointResults[name] = {
      ok: true,
      duration_ms: Date.now() - started,
      summary,
    };
  } catch (error) {
    endpointResults[name] = {
      ok: false,
      duration_ms: null,
      error: error instanceof Error ? error.message : String(error),
      status: error && typeof error === "object" && "status" in error ? error.status : undefined,
    };
  }
}

await runEndpoint("GET /models", async () => {
  const models = await client.listModels();
  const ids = Array.isArray(models.data) ? models.data.map((model) => model.id) : [];

  assert(ids.includes("deepseek-v4-flash"), "models response did not include deepseek-v4-flash");
  assert(ids.includes("deepseek-v4-pro"), "models response did not include deepseek-v4-pro");

  return {
    object: models.object,
    ids,
  };
});

await runEndpoint("GET /user/balance", async () => {
  const balance = await client.getUserBalance();
  assert(typeof balance.is_available === "boolean", "balance response missing boolean is_available");
  assert(Array.isArray(balance.balance_infos), "balance response missing balance_infos array");

  return {
    is_available: balance.is_available,
    currencies: balance.balance_infos.map((item) => item.currency),
  };
});

await runEndpoint("POST /chat/completions non-thinking", async () => {
  const result = await client.createChatCompletion({
    model: "deepseek-v4-flash",
    messages: [{ role: "user", content: "Reply exactly with LIVE_CHAT_OK" }],
    thinking: { type: "disabled" },
    max_tokens: 32,
  });

  const choice = result.response.choices?.[0];
  const text = choice?.message?.content ?? "";

  assert(result.response.object === "chat.completion", "non-stream chat object shape mismatch");
  assert(result.response.model === "deepseek-v4-flash", "non-stream chat returned unexpected model");
  assert(text.includes("LIVE_CHAT_OK"), `non-stream chat text missing marker: ${text}`);
  assert(!choice?.message?.reasoning_content, "non-thinking chat unexpectedly returned reasoning_content");

  return {
    id: result.response.id,
    model: result.response.model,
    finish_reason: choice?.finish_reason ?? null,
    text,
    has_reasoning_content: Boolean(choice?.message?.reasoning_content),
    usage_keys: result.response.usage ? Object.keys(result.response.usage).sort() : [],
  };
});

await runEndpoint("POST /chat/completions thinking stream", async () => {
  const result = await client.createChatCompletion({
    model: "deepseek-v4-flash",
    stream: true,
    messages: [{ role: "user", content: "Compute 19 + 23, then end with LIVE_STREAM_REASONING_OK:42" }],
    thinking: { type: "enabled" },
    reasoning_effort: "high",
    max_tokens: 256,
  });

  const choice = result.response.choices?.[0];
  const text = choice?.message?.content ?? "";
  const reasoning = choice?.message?.reasoning_content ?? "";

  assert(result.response.object === "chat.completion", "stream chat aggregate object shape mismatch");
  assert((result.streamChunkCount ?? 0) > 0, "stream chat returned no chunks");
  assert(text.includes("LIVE_STREAM_REASONING_OK:42"), `stream chat text missing marker: ${text}`);
  assert(reasoning.length > 0, "thinking stream did not aggregate reasoning_content");

  return {
    id: result.response.id,
    model: result.response.model,
    chunks: result.streamChunkCount ?? null,
    finish_reason: choice?.finish_reason ?? null,
    text,
    reasoning_preview: reasoning.slice(0, 200),
    reasoning_length: reasoning.length,
    usage_keys: result.response.usage ? Object.keys(result.response.usage).sort() : [],
  };
});

await runEndpoint("POST /beta/completions FIM", async () => {
  const result = await client.createCompletion({
    model: "deepseek-v4-pro",
    prompt: 'const marker = "LIVE_',
    suffix: '";',
    max_tokens: 16,
  });

  const choice = result.response.choices?.[0];
  const text = choice?.text ?? "";

  assert(result.response.object === "text_completion", "FIM completion object shape mismatch");
  assert(result.response.model === "deepseek-v4-pro", "FIM completion returned unexpected model");
  assert(typeof text === "string", "FIM completion text was not a string");

  return {
    id: result.response.id,
    model: result.response.model,
    finish_reason: choice?.finish_reason ?? null,
    text,
    usage_keys: result.response.usage ? Object.keys(result.response.usage).sort() : [],
  };
});

const mcpResults = {};

async function runTool(tool, args) {
  try {
    const server = createDeepSeekMcpServer({
      client,
      conversations: new ConversationStore(200),
      defaultModel: "deepseek-v4-flash",
      version: "live-smoke",
    });

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcpClient = new Client({ name: "live-smoke-client", version: "1.0.0" });

    await Promise.all([server.connect(serverTransport), mcpClient.connect(clientTransport)]);
    const result = await mcpClient.callTool({ name: tool, arguments: args });

    await mcpClient.close();
    await server.close();

    const textBlock = result.content?.find((content) => content.type === "text");

    mcpResults[tool] = {
      ok: !result.isError,
      isError: !!result.isError,
      text_preview: textBlock?.text ? textBlock.text.slice(0, 200) : null,
      structured_keys: result.structuredContent ? Object.keys(result.structuredContent).sort() : [],
    };
  } catch (error) {
    mcpResults[tool] = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

await runTool("list_models", {});
await runTool("get_user_balance", {});
await runTool("chat_completion", {
  message: "Reply exactly with MCP_CHAT_OK",
  model: "deepseek-v4-flash",
  thinking: { type: "disabled" },
  max_tokens: 32,
});
await runTool("completion", {
  prompt: 'const marker = "MCP_',
  suffix: '";',
  model: "deepseek-v4-pro",
  max_tokens: 16,
});

const summary = {
  ok: true,
  base_url: baseUrl,
  endpoint_results: endpointResults,
  mcp_tool_results: mcpResults,
};

console.log(JSON.stringify(summary, null, 2));

const failedEndpoints = Object.values(endpointResults).filter((result) => !result.ok).length;
const failedTools = Object.values(mcpResults).filter((result) => !result.ok).length;

if (failedEndpoints > 0 || failedTools > 0) {
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
