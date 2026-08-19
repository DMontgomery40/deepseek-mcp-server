import { createServer, IncomingMessage, Server, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export interface StreamableHttpRuntime {
  server: Server;
  close: () => Promise<void>;
}

export interface StreamableHttpOptions {
  host: string;
  port: number;
  path: string;
  statefulSession: boolean;
  allowedOrigins?: string[];
}

export async function startStreamableHttpServer(
  createMcpServer: () => McpServer,
  options: StreamableHttpOptions,
): Promise<StreamableHttpRuntime> {
  const activeConnections = new Set<McpConnection>();
  const statefulConnection = options.statefulSession
    ? await createMcpConnection(createMcpServer, true)
    : undefined;

  if (statefulConnection) {
    activeConnections.add(statefulConnection);
  }

  const server = createServer(async (req, res) => {
    let requestConnection: McpConnection | undefined;

    try {
      if (!statefulConnection && shouldHandleWithMcpTransport(req, options.path)) {
        requestConnection = await createMcpConnection(createMcpServer, false);
        activeConnections.add(requestConnection);
        res.once("close", () => {
          void closeMcpConnection(requestConnection, activeConnections);
        });
      }

      await handleIncomingRequest(
        req,
        res,
        options.path,
        statefulConnection?.transport ?? requestConnection?.transport,
        options.statefulSession,
        options.allowedOrigins ?? [],
      );
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
    server,
    close: async () => {
      await Promise.all(
        [...activeConnections].map((connection) => closeMcpConnection(connection, activeConnections)),
      );
      await closeServer(server);
    },
  };
}

interface McpConnection {
  mcpServer: McpServer;
  transport: StreamableHTTPServerTransport;
}

async function createMcpConnection(
  createMcpServer: () => McpServer,
  statefulSession: boolean,
): Promise<McpConnection> {
  const mcpServer = createMcpServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: statefulSession ? () => randomUUID() : undefined,
  });
  await mcpServer.connect(transport);
  return { mcpServer, transport };
}

async function closeMcpConnection(
  connection: McpConnection | undefined,
  activeConnections: Set<McpConnection>,
): Promise<void> {
  if (!connection || !activeConnections.delete(connection)) {
    return;
  }

  await connection.transport.close();
  await connection.mcpServer.close();
}

function shouldHandleWithMcpTransport(
  req: IncomingMessage,
  expectedPath: string,
): boolean {
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  return requestUrl.pathname === expectedPath && req.method === "POST";
}

async function handleIncomingRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedPath: string,
  transport: StreamableHTTPServerTransport | undefined,
  statefulSession: boolean,
  allowedOrigins: string[],
): Promise<void> {
  const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  if (requestUrl.pathname !== expectedPath) {
    res.statusCode = 404;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: `Not found: ${requestUrl.pathname}` }));
    return;
  }

  const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  if (origin && !allowedOrigins.includes(origin)) {
    res.statusCode = 403;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: `Origin not allowed: ${origin}` }));
    return;
  }

  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, Mcp-Protocol-Version");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (!statefulSession && req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: `Method not allowed: ${req.method ?? "UNKNOWN"}` }));
    return;
  }

  if (!transport) {
    throw new Error("MCP transport was not initialized for this request");
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
