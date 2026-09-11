import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/client/stdio";
import { describe, expect, it } from "vitest";

const SERVER_ENTRYPOINT = fileURLToPath(new URL("../build/index.js", import.meta.url));
const EXPECTED_TOOLS = [
  "chat_completion",
  "completion",
  "create_response",
  "delete_file",
  "get_user_balance",
  "list_conversations",
  "list_files",
  "list_models",
  "reset_conversation",
  "retrieve_file",
  "upload_file",
];

describe("stdio entrypoint", () => {
  it.each([
    {
      label: "2026-07-28",
      expectedEra: "modern" as const,
      versionNegotiation: { mode: "auto" as const },
    },
    {
      label: "legacy",
      expectedEra: "legacy" as const,
      versionNegotiation: { mode: "legacy" as const },
    },
  ])(
    "starts, lists all tools, and shuts down cleanly for $label clients",
    async ({ expectedEra, versionNegotiation }) => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [SERVER_ENTRYPOINT],
        env: {
          ...getDefaultEnvironment(),
          DEEPSEEK_API_KEY: "stdio-integration-test",
          MCP_TRANSPORT: "stdio",
        },
        stderr: "pipe",
      });
      const client = new Client(
        { name: `stdio-${expectedEra}-test`, version: "1.0.0" },
        { versionNegotiation },
      );
      let stderr = "";
      transport.stderr?.on("data", (chunk) => {
        stderr += chunk.toString();
      });

      try {
        await client.connect(transport);
        expect(client.getProtocolEra()).toBe(expectedEra);

        const tools = await client.listTools();
        expect(tools.tools.map((tool) => tool.name).sort()).toEqual(EXPECTED_TOOLS);
      } catch (error) {
        throw new Error(
          `stdio ${expectedEra} integration failed: ${
            error instanceof Error ? error.message : String(error)
          }\n${stderr}`,
          { cause: error },
        );
      } finally {
        await client.close().catch(() => undefined);
      }

      expect(transport.pid).toBeNull();
    },
    15_000,
  );
});
