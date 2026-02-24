#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.DEEPSEEK_REMOTE_MCP_URL || "https://deepseek-mcp.ragweld.com/mcp";
const token = process.env.DEEPSEEK_MCP_AUTH_TOKEN;
const model = process.env.DEEPSEEK_REMOTE_SMOKE_MODEL || "deepseek-chat";
const expectedText = process.env.DEEPSEEK_REMOTE_SMOKE_EXPECT || "REMOTE_SMOKE_OK";
const prompt = process.env.DEEPSEEK_REMOTE_SMOKE_PROMPT || `Reply with exactly: ${expectedText}`;
const timeoutMs = Number(process.env.DEEPSEEK_REMOTE_SMOKE_TIMEOUT_MS || 30000);

if (!token) {
  console.error("DEEPSEEK_MCP_AUTH_TOKEN is required");
  process.exit(2);
}

const transport = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  },
});

const client = new Client({
  name: "deepseek-remote-smoke",
  version: "1.0.0",
});

const requiredTools = [
  "chat_completion",
  "completion",
  "list_models",
  "get_user_balance",
  "reset_conversation",
  "list_conversations",
];

const summary = {
  ok: true,
  url,
  checks: {
    initialize: false,
    tools_list: false,
    tools_call: false,
  },
  details: {},
};

let exitCode = 0;

try {
  await withTimeout(client.connect(transport), "connect");
  summary.checks.initialize = true;

  const listed = await withTimeout(client.listTools(), "tools/list");
  const toolNames = listed.tools.map((tool) => tool.name).sort();
  const missing = requiredTools.filter((name) => !toolNames.includes(name));
  if (missing.length > 0) {
    throw new Error(`tools/list missing required tools: ${missing.join(", ")}`);
  }

  summary.checks.tools_list = true;
  summary.details.tool_count = toolNames.length;
  summary.details.tools = toolNames;

  const result = await withTimeout(
    client.callTool({
      name: "chat_completion",
      arguments: {
        message: prompt,
        model,
        temperature: 0,
        max_tokens: 32,
      },
    }),
    "tools/call",
  );

  if (result.isError) {
    throw new Error(`tools/call returned isError=true: ${JSON.stringify(result.structuredContent ?? null)}`);
  }

  const textBlock = result.content?.find((content) => content.type === "text");
  const text = textBlock?.text?.trim() ?? "";
  if (text !== expectedText) {
    throw new Error(`unexpected tool output: expected "${expectedText}" but got "${text}"`);
  }

  summary.checks.tools_call = true;
  summary.details.tools_call_text = text;
  console.log(JSON.stringify(summary, null, 2));
} catch (error) {
  exitCode = 1;
  summary.ok = false;
  summary.error = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify(summary, null, 2));
} finally {
  await withTimeout(client.close(), "close").catch(() => {});
}

process.exit(exitCode);

function withTimeout(promise, label) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timer);
  });
}
