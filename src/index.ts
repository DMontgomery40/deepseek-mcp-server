#!/usr/bin/env node
import dotenv from "dotenv";

dotenv.config();

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { ConversationStore } from "./conversation-store.js";
import { loadRuntimeConfig } from "./config.js";
import { DeepSeekApiClient } from "./deepseek/client.js";
import { createDeepSeekMcpServer } from "./mcp-server.js";
import { startStreamableHttpServer } from "./transports/http.js";

async function main(): Promise<void> {
  const config = loadRuntimeConfig();

  const client = new DeepSeekApiClient({
    apiKey: config.deepseekApiKey,
    baseUrl: config.deepseekBaseUrl,
    timeoutMs: config.deepseekRequestTimeoutMs,
    enableReasonerFallback: config.enableReasonerFallback,
    fallbackModel: config.fallbackModel,
  });

  const conversations = new ConversationStore(config.conversationMaxMessages);

  const mcpServer = createDeepSeekMcpServer({
    client,
    conversations,
    defaultModel: config.defaultModel,
  });

  if (config.transport === "stdio") {
    const transport = new StdioServerTransport();
    await mcpServer.connect(transport);

    console.error("DeepSeek MCP server connected via stdio");

    installShutdownHandlers(async () => {
      await mcpServer.close();
    });

    return;
  }

  const httpRuntime = await startStreamableHttpServer(mcpServer, {
    host: config.httpHost,
    port: config.httpPort,
    path: config.httpPath,
    statefulSession: config.httpStatefulSession,
  });

  console.error(
    `DeepSeek MCP server running on Streamable HTTP at http://${config.httpHost}:${config.httpPort}${config.httpPath}`,
  );

  installShutdownHandlers(async () => {
    await httpRuntime.close();
    await mcpServer.close();
  });
}

function installShutdownHandlers(closeFn: () => Promise<void>): void {
  let shuttingDown = false;

  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.error(`Received ${signal}, shutting down...`);

    try {
      await closeFn();
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
}

void main().catch((error) => {
  console.error("[Fatal Error]", error);
  process.exit(1);
});
