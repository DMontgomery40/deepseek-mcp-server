#!/usr/bin/env node
import { DeepSeekApiClient } from "../build/deepseek/client.js";
import { createDeepSeekMcpServer } from "../build/mcp-server.js";
import { ConversationStore } from "../build/conversation-store.js";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

const apiKey = process.env.DEEPSEEK_API_KEY;
if (!apiKey) {
  console.error("DEEPSEEK_API_KEY is required for live smoke tests");
  process.exit(2);
}

const baseUrl = process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com";

const client = new DeepSeekApiClient({
  apiKey,
  baseUrl,
  timeoutMs: Number(process.env.DEEPSEEK_REQUEST_TIMEOUT_MS || 120000),
  enableReasonerFallback: true,
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
  return {
    count: Array.isArray(models.data) ? models.data.length : 0,
    first_models: Array.isArray(models.data) ? models.data.slice(0, 5).map((m) => m.id) : [],
  };
});

await runEndpoint("GET /user/balance", async () => {
  const balance = await client.getUserBalance();
  return {
    is_available: balance.is_available,
    currencies: Array.isArray(balance.balance_infos) ? balance.balance_infos.map((b) => b.currency) : [],
  };
});

await runEndpoint("POST /chat/completions (non-stream)", async () => {
  const result = await client.createChatCompletion({
    model: "deepseek-chat",
    messages: [{ role: "user", content: "Reply exactly with LIVE_CHAT_OK" }],
    temperature: 0,
    max_tokens: 32,
  });

  return {
    model: result.response.model,
    finish_reason: result.response.choices?.[0]?.finish_reason ?? null,
    text: result.response.choices?.[0]?.message?.content ?? null,
    fallback: result.fallback ?? null,
  };
});

await runEndpoint("POST /chat/completions (stream)", async () => {
  const result = await client.createChatCompletion({
    model: "deepseek-chat",
    stream: true,
    messages: [{ role: "user", content: "Reply exactly with LIVE_STREAM_OK" }],
    temperature: 0,
    max_tokens: 32,
  });

  return {
    model: result.response.model,
    chunks: result.streamChunkCount ?? null,
    text: result.response.choices?.[0]?.message?.content ?? null,
  };
});

await runEndpoint("POST /completions (non-stream)", async () => {
  const result = await client.createCompletion({
    model: "deepseek-chat",
    prompt: "Say LIVE_COMPLETION_OK",
    temperature: 0,
    max_tokens: 16,
  });

  return {
    model: result.response.model,
    finish_reason: result.response.choices?.[0]?.finish_reason ?? null,
    text: result.response.choices?.[0]?.text ?? null,
  };
});

await runEndpoint("POST /completions (stream)", async () => {
  const result = await client.createCompletion({
    model: "deepseek-chat",
    prompt: "Say LIVE_COMPLETION_STREAM_OK",
    stream: true,
    temperature: 0,
    max_tokens: 16,
  });

  return {
    model: result.response.model,
    chunks: result.streamChunkCount ?? null,
    text: result.response.choices?.[0]?.text ?? null,
  };
});

const mcpResults = {};

async function runTool(tool, args) {
  try {
    const server = createDeepSeekMcpServer({
      client,
      conversations: new ConversationStore(200),
      defaultModel: "deepseek-chat",
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
  model: "deepseek-chat",
  temperature: 0,
  max_tokens: 32,
});
await runTool("completion", {
  prompt: "Say MCP_COMPLETION_OK",
  model: "deepseek-chat",
  temperature: 0,
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
