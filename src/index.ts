#!/usr/bin/env node
// NOTE: Ensure @modelcontextprotocol/sdk is installed for the following import to work
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types";
import axios from "axios";
import dotenv from "dotenv";
import { DeepSeekResponse, ChatMessage } from "./types";
import { z } from "zod";

// Load environment variables
dotenv.config();
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
if (!DEEPSEEK_API_KEY) throw new McpError(ErrorCode.InvalidRequest, "Missing DEEPSEEK_API_KEY");

const PROMPTS = {
  "system": {
    name: "system",
    description: "Set system behavior for the AI",
    arguments: [
      {
        name: "content",
        description: "System instruction",
        required: true
      }
    ]
  },
  "chat": {
    name: "chat",
    description: "Chat with the AI",
    arguments: [
      {
        name: "message",
        description: "User message",
        required: true
      },
      {
        name: "temperature",
        description: "Response temperature (0-1)",
        required: false
      }
    ]
  }
};

const server = new McpServer({
  name: "deepseek-mcp-server",
  version: "1.1.0"
});

// Register prompt templates using server.prompt()
server.prompt(
  "system",
  { content: z.string() },
  async ({ content }: { content: string }) => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `[System Instruction]\n${content}`
          }
        }
      ]
    };
  }
);

server.prompt(
  "chat",
  { message: z.string(), temperature: z.string().optional() },
  async ({ message, temperature }: { message: string; temperature?: string }) => {
    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: message
          }
        }
      ],
      temperature
    };
  }
);

// Example: Register a chat-completion tool (update as needed)
server.tool(
  "chat_completion",
  {
    message: { type: "string", optional: true },
    messages: { type: "array", items: { type: "object" }, optional: true },
    model: { type: "string", default: "deepseek-chat" },
    temperature: { type: "number", default: 0.7 },
    max_tokens: { type: "number", default: 8000 },
    top_p: { type: "number", default: 1.0 },
    frequency_penalty: { type: "number", default: 0.1 },
    presence_penalty: { type: "number", default: 0 },
    reasoning_content: { type: "string", optional: true },
    stream: { type: "boolean", default: false }
  },
  async (args: any) => {
    let messages: ChatMessage[];
    if (args.message) {
      messages = [{ role: 'user', content: args.message }];
    } else if (args.messages) {
      messages = args.messages;
    } else {
      throw new McpError(ErrorCode.InvalidRequest, "Either 'message' or 'messages' must be provided");
    }
    try {
      const response = await axios.post<DeepSeekResponse>(
        "https://api.deepseek.com/chat/completions",
        {
          messages,
          model: args.model,
          temperature: args.temperature,
          max_tokens: args.max_tokens,
          top_p: args.top_p,
          frequency_penalty: args.frequency_penalty,
          presence_penalty: args.presence_penalty,
          reasoning_content: args.reasoning_content,
          stream: args.stream
        },
        {
          headers: {
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      return {
        content: [{
          type: "text",
          text: response.data.choices[0].message.content
        }]
      };
    } catch (error: any) {
      throw new McpError(ErrorCode.InternalError, error.message);
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("DeepSeek MCP server running on stdio");
}

main().catch(console.error);