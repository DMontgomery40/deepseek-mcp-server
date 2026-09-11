import { AddressInfo } from "node:net";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it, vi } from "vitest";

import { ConversationStore } from "../src/conversation-store.js";
import { DeepSeekApiClient, DeepSeekApiError } from "../src/deepseek/client.js";
import { createDeepSeekMcpServer } from "../src/mcp-server.js";
import { startStreamableHttpServer } from "../src/transports/http.js";

describe("Streamable HTTP transport", () => {
  it(
    "negotiates the 2026-07-28 protocol and returns structured tool results",
    async () => {
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
        expect(preflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain(
          "mcp-protocol-version",
        );
        expect(preflight.headers.get("access-control-expose-headers")?.toLowerCase()).toContain(
          "mcp-session-id",
        );

        const rejectedOrigin = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
          method: "OPTIONS",
          headers: { Origin: "https://attacker.example" },
        });
        expect(rejectedOrigin.status).toBe(403);

        await client.connect(transport);
        expect(client.getProtocolEra()).toBe("modern");

        const tools = await client.listTools();
        expect(tools.tools.map((tool) => tool.name)).toContain("create_response");

        const models = await client.callTool({ name: "list_models", arguments: {} });
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
    },
  );

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
    const client = new Client({ name: "legacy-http-test-client", version: "1.0.0" });
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
