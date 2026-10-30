import "../ensure-web-crypto.js";
import {
  createServer,
  IncomingMessage,
  Server,
  ServerResponse,
} from "node:http";
import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";

export interface StreamableHttpRuntime {
  server: Server;
  close: () => Promise<void>;
}

export interface StreamableHttpOptions {
  host: string;
  port: number;
  path: string;
  allowedOrigins?: string[];
  authToken?: string;
  trustAuthGateway?: boolean;
}

export async function startStreamableHttpServer(
  createMcpServer: () => McpServer,
  options: StreamableHttpOptions,
): Promise<StreamableHttpRuntime> {
  const local =
    options.host === "localhost" ||
    options.host === "::1" ||
    (isIP(options.host) === 4 && options.host.startsWith("127."));
  if (!local && !options.authToken && !options.trustAuthGateway) {
    throw new Error(
      "Non-loopback MCP HTTP requires authentication: set MCP_HTTP_AUTH_TOKEN or explicitly trust an authenticated gateway with MCP_HTTP_TRUST_AUTH_GATEWAY=true",
    );
  }
  const mcpHandler = createMcpHandler(createMcpServer, {
    legacy: "stateless",
    responseMode: "auto",
    onerror: (error) => console.error("[MCP HTTP Error]", error),
  });
  const nodeHandler = toNodeHandler(mcpHandler, {
    onerror: (error) => console.error("[MCP Node Adapter Error]", error),
  });

  const server = createServer((req, res) => {
    void handleIncomingRequest(
      req,
      res,
      options.path,
      options.allowedOrigins ?? [],
      nodeHandler,
      options.authToken,
    ).catch((error) => writeJsonError(res, 500, error));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => resolve());
  });

  return {
    server,
    close: async () => {
      await mcpHandler.close();
      await closeServer(server);
    },
  };
}

type NodeMcpHandler = ReturnType<typeof toNodeHandler>;

async function handleIncomingRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedPath: string,
  allowedOrigins: string[],
  nodeHandler: NodeMcpHandler,
  authToken: string | undefined,
): Promise<void> {
  const requestUrl = new URL(
    req.url ?? "/",
    `http://${req.headers.host ?? "localhost"}`,
  );
  if (requestUrl.pathname !== expectedPath) {
    writeJsonError(res, 404, new Error(`Not found: ${requestUrl.pathname}`));
    return;
  }

  const origin =
    typeof req.headers.origin === "string" ? req.headers.origin : undefined;
  if (origin && !allowedOrigins.includes(origin)) {
    writeJsonError(res, 403, new Error(`Origin not allowed: ${origin}`));
    return;
  }

  setCorsHeaders(res, origin);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (authToken && !matchesBearerToken(req.headers.authorization, authToken)) {
    res.setHeader("WWW-Authenticate", 'Bearer realm="deepseek-mcp"');
    writeJsonError(res, 401, new Error("Unauthorized"));
    return;
  }

  await nodeHandler(req, res);
}

function matchesBearerToken(
  authorization: string | undefined,
  expected: string,
): boolean {
  const supplied = /^Bearer (.+)$/i.exec(authorization ?? "")?.[1];
  if (!supplied) return false;
  const received = Buffer.from(supplied);
  const wanted = Buffer.from(expected);
  return received.length === wanted.length && timingSafeEqual(received, wanted);
}

function setCorsHeaders(res: ServerResponse, origin: string | undefined): void {
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept, Authorization, Mcp-Protocol-Version, Mcp-Method, Mcp-Name, Mcp-Session-Id, Last-Event-ID",
  );
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Mcp-Protocol-Version, Mcp-Session-Id, WWW-Authenticate",
  );
}

function writeJsonError(
  res: ServerResponse,
  status: number,
  error: unknown,
): void {
  if (res.writableEnded) {
    return;
  }

  if (!res.headersSent) {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
  }

  const message = error instanceof Error ? error.message : String(error);
  res.end(JSON.stringify({ error: message }));
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
