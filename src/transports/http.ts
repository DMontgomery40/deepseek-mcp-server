import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export interface StreamableHttpRuntime {
  transport: StreamableHTTPServerTransport;
  server: Server;
  close: () => Promise<void>;
}

export interface StreamableHttpOptions {
  host: string;
  port: number;
  path: string;
  statefulSession: boolean;
}

export async function startStreamableHttpServer(
  mcpServer: McpServer,
  options: StreamableHttpOptions,
): Promise<StreamableHttpRuntime> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: options.statefulSession ? () => randomUUID() : undefined,
  });

  await mcpServer.connect(transport);

  const server = createServer(async (req, res) => {
    try {
      await handleIncomingRequest(req, res, options.path, transport);
    } catch (error) {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "application/json");
      }

      if (!res.writableEnded) {
        const message = error instanceof Error ? error.message : String(error);
        res.end(JSON.stringify({ error: message }));
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => resolve());
  });

  return {
    transport,
    server,
    close: async () => {
      await transport.close();
      await closeServer(server);
    },
  };
}

async function handleIncomingRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedPath: string,
  transport: StreamableHTTPServerTransport,
): Promise<void> {
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (requestUrl.pathname !== expectedPath) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: `Not found: ${requestUrl.pathname}` }));
    return;
  }

  // Basic CORS support for browser-based MCP clients.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Mcp-Session-Id, Last-Event-ID");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  const parsedBody = await parseJsonBody(req);
  await transport.handleRequest(req, res, parsedBody);
}

async function parseJsonBody(req: IncomingMessage): Promise<unknown> {
  const method = req.method ?? "GET";
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return undefined;
  }

  const contentType = req.headers["content-type"];
  const isJson = typeof contentType === "string" && contentType.toLowerCase().includes("application/json");
  if (!isJson) {
    return undefined;
  }

  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
  }

  if (!raw.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON request body");
  }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
