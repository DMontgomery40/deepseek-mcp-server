import { AddressInfo } from "node:net";

import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { describe, expect, it, vi } from "vitest";

import { ConversationStore } from "../src/conversation-store.js";
import { DeepSeekApiClient, DeepSeekApiError } from "../src/deepseek/client.js";
import { createDeepSeekMcpServer } from "../src/mcp-server.js";
import { startStreamableHttpServer } from "../src/transports/http.js";

describe("Streamable HTTP transport", () => {
  it("shares the tool admission limit across stateless HTTP server instances", async () => {
    const api = new DeepSeekApiClient({ apiKey: "test" });
    const conversations = new ConversationStore(200);
    const runtime = await startStreamableHttpServer(
      () =>
        createDeepSeekMcpServer({
          client: api,
          conversations,
          defaultModel: "deepseek-flash",
          toolRateLimit: 1,
        }),
      { host: "127.0.0.1", port: 0, path: "/mcp" },
    );
    const { port } = runtime.server.address() as AddressInfo;
    const client = new Client(
      { name: "rate-test", version: "test" },
      { versionNegotiation: { mode: "auto" } },
    );
    try {
      await client.connect(
        new StreamableHTTPClientTransport(
          new URL(`http://127.0.0.1:${port}/mcp`),
        ),
      );
      expect(
        (await client.callTool({ name: "list_conversations", arguments: {} }))
          .isError,
      ).toBeFalsy();
      const denied = await client.callTool({
        name: "list_conversations",
        arguments: {},
      });
      expect(denied.isError).toBe(true);
      expect(denied.structuredContent).toMatchObject({
        error_type: "tool_rate_limit",
      });
    } finally {
      await client.close();
      await runtime.close();
    }
  });
  it("requires an explicit authentication boundary for non-loopback HTTP", async () => {
    await expect(
      startStreamableHttpServer(
        () => {
          throw new Error("must not create server");
        },
        { host: "0.0.0.0", port: 0, path: "/mcp" },
      ),
    ).rejects.toThrow("authentication");
  });

  it("checks configured bearer authentication before dispatching HTTP requests", async () => {
    const api = { listModels: vi.fn() };
    const runtime = await startStreamableHttpServer(
      () =>
        createDeepSeekMcpServer({
          client: api as unknown as DeepSeekApiClient,
          conversations: new ConversationStore(200),
          defaultModel: "deepseek-flash",
        }),
      { host: "127.0.0.1", port: 0, path: "/mcp", authToken: "test-token" },
    );
    const { port } = runtime.server.address() as AddressInfo;
    const endpoint = `http://127.0.0.1:${port}/mcp`;
    try {
      for (const headers of [{}, { Authorization: "Bearer wrong" }]) {
        const response = await fetch(endpoint, {
          method: "POST",
          headers,
          body: "{}",
        });
        expect(response.status).toBe(401);
        expect(response.headers.get("www-authenticate")).toContain("Bearer");
      }
      const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
        requestInit: { headers: { Authorization: "Bearer test-token" } },
      });
      const client = new Client(
        { name: "auth-test", version: "test" },
        { versionNegotiation: { mode: "auto" } },
      );
      try {
        await client.connect(transport);
        expect((await client.listTools()).tools).toHaveLength(11);
      } finally {
        await client.close();
      }
      expect(api.listModels).not.toHaveBeenCalled();
    } finally {
      await runtime.close();
    }
  });
  it("propagates modern request cancellation and never saves a cancelled response", async () => {
    let providerSignal: AbortSignal | undefined;
    let releaseProvider: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const completed = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const api = new DeepSeekApiClient({
      apiKey: "test",
      fetchFn: async (_url, init) => {
        providerSignal = init?.signal ?? undefined;
        markStarted?.();
        await completed;
        return Response.json({
          model: "deepseek-flash",
          choices: [
            {
              message: { role: "assistant", content: "cancelled answer" },
              finish_reason: "stop",
            },
          ],
        });
      },
    });
    const conversations = new ConversationStore(200);
    const runtime = await startStreamableHttpServer(
      () =>
        createDeepSeekMcpServer({
          client: api,
          conversations,
          defaultModel: "deepseek-flash",
        }),
      { host: "127.0.0.1", port: 0, path: "/mcp" },
    );
    const { port } = runtime.server.address() as AddressInfo;
    const abort = new AbortController();
    const pending = fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      signal: abort.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        "Mcp-Protocol-Version": "2026-07-28",
        "Mcp-Method": "tools/call",
        "Mcp-Name": "chat_completion",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "chat_completion",
          arguments: { message: "hi", conversation_id: "cancel-test" },
          _meta: {
            "io.modelcontextprotocol/protocolVersion": "2026-07-28",
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    }).catch(() => undefined);
    try {
      await started;
      abort.abort();
      await pending;
      await vi.waitFor(() => expect(providerSignal?.aborted).toBe(true));
      releaseProvider?.();
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(conversations.listConversationIds()).not.toContain("cancel-test");
    } finally {
      releaseProvider?.();
      await runtime.close();
    }
  });
  it("negotiates the 2026-07-28 protocol and returns structured tool results", async () => {
    const api = {
      createChatCompletion: vi.fn(async () => {
        throw new DeepSeekApiError("upstream unavailable", { status: 503 });
      }),
      createCompletion: vi.fn(),
      createResponse: vi.fn(),
      listModels: vi.fn(async () => ({
        object: "list",
        data: [
          { id: "deepseek-v4-flash", object: "model" },
          { id: "deepseek-v4-pro", object: "model" },
        ],
      })),
      getUserBalance: vi.fn(),
    };

    const conversations = new ConversationStore(200);
    const runtime = await startStreamableHttpServer(
      () =>
        createDeepSeekMcpServer({
          client: api as unknown as DeepSeekApiClient,
          conversations,
          defaultModel: "deepseek-v4-flash",
          version: "http-test",
        }),
      {
        host: "127.0.0.1",
        port: 0,
        path: "/mcp",
        allowedOrigins: ["https://trusted.example"],
      },
    );
    const address = runtime.server.address() as AddressInfo;
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${address.port}/mcp`),
    );
    const client = new Client(
      { name: "http-test-client", version: "1.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );

    try {
      const preflight = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
        method: "OPTIONS",
        headers: { Origin: "https://trusted.example" },
      });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-origin")).toBe(
        "https://trusted.example",
      );
      expect(
        preflight.headers.get("access-control-allow-headers")?.toLowerCase(),
      ).toContain("mcp-protocol-version");
      expect(
        preflight.headers.get("access-control-expose-headers")?.toLowerCase(),
      ).toContain("mcp-session-id");

      const rejectedOrigin = await fetch(
        `http://127.0.0.1:${address.port}/mcp`,
        {
          method: "OPTIONS",
          headers: { Origin: "https://attacker.example" },
        },
      );
      expect(rejectedOrigin.status).toBe(403);

      await client.connect(transport);
      expect(client.getProtocolEra()).toBe("modern");

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain("create_response");
      expect(tools).toMatchObject({ ttlMs: 3_600_000, cacheScope: "public" });

      const prompts = await client.listPrompts();
      expect(prompts).toMatchObject({ ttlMs: 3_600_000, cacheScope: "public" });

      const resources = await client.listResources();
      expect(resources).toMatchObject({ ttlMs: 0, cacheScope: "private" });

      const endpointResource = await client.readResource({
        uri: "deepseek://api/endpoints",
      });
      expect(endpointResource).toMatchObject({
        ttlMs: 3_600_000,
        cacheScope: "public",
      });

      const runtimeResource = await client.readResource({
        uri: "deepseek://api/runtime",
      });
      expect(runtimeResource).toMatchObject({
        ttlMs: 0,
        cacheScope: "private",
      });

      const models = await client.callTool({
        name: "list_models",
        arguments: {},
      });
      expect(models.isError).toBeFalsy();
      expect(models.content[0]).toMatchObject({
        type: "text",
        text: "deepseek-v4-flash\ndeepseek-v4-pro",
      });

      const failure = await client.callTool({
        name: "chat_completion",
        arguments: { message: "hello" },
      });
      expect(failure.isError).toBe(true);
      expect(failure.structuredContent).toMatchObject({
        error_type: "deepseek_api_error",
        status: 503,
        retryable: true,
      });
    } finally {
      await client.close().catch(() => undefined);
      await runtime.close();
    }
  });

  it("keeps stateless compatibility with 2025-era clients", async () => {
    const api = {
      createChatCompletion: vi.fn(),
      createCompletion: vi.fn(),
      createResponse: vi.fn(),
      listModels: vi.fn(async () => ({
        object: "list",
        data: [{ id: "deepseek-flash", object: "model" }],
      })),
      getUserBalance: vi.fn(),
    };
    const runtime = await startStreamableHttpServer(
      () =>
        createDeepSeekMcpServer({
          client: api as unknown as DeepSeekApiClient,
          conversations: new ConversationStore(200),
          defaultModel: "deepseek-flash",
          version: "http-test",
        }),
      { host: "127.0.0.1", port: 0, path: "/mcp" },
    );
    const address = runtime.server.address() as AddressInfo;
    const client = new Client({
      name: "legacy-http-test-client",
      version: "1.0.0",
    });
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${address.port}/mcp`),
    );

    try {
      await client.connect(transport);
      expect(client.getProtocolEra()).toBe("legacy");

      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toContain("upload_file");
    } finally {
      await client.close().catch(() => undefined);
      await runtime.close();
    }
  });
});
