#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ErrorCode,
  McpError
} from "@modelcontextprotocol/sdk/types.js";
import axios, { AxiosInstance } from "axios";
import dotenv from "dotenv";
import { 
  DeepSeekResponse,
  ChatCompletionArgs,
  isValidChatCompletionArgs,
  ChatMessage
} from "./types.js";

dotenv.config();

const API_KEY = process.env.DEEPSEEK_API_KEY;
if (!API_KEY) {
  throw new Error("DEEPSEEK_API_KEY environment variable is required");
}

const API_CONFIG = {
  BASE_URL: 'https://api.deepseek.com/v1',
  DEFAULT_MODEL: 'deepseek-reasoner',
  ENDPOINTS: {
    CHAT: '/chat/completions'
  }
} as const;

class DeepSeekServer {
  private server: Server;
  private axiosInstance: AxiosInstance;

  constructor() {
    this.server = new Server({
      name: "deepseek-mcp-server",
      version: "0.1.0"
    }, {
      capabilities: {
        tools: {}
      }
    });

    // Configure axios with defaults
    this.axiosInstance = axios.create({
      baseURL: API_CONFIG.BASE_URL,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error("[MCP Error]", error);
    };

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupHandlers(): void {
    this.setupToolHandlers();
  }

  private setupToolHandlers(): void {
    this.server.setRequestHandler(
      ListToolsRequestSchema,
      async () => ({
        tools: [{
          name: "chat_completion",
          description: "Generate a chat completion using DeepSeek's API",
          inputSchema: {
            type: "object",
            properties: {
              message: {
                type: "string",
                description: "The message to send to the model"
              },
              messages: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    role: {
                      type: "string",
                      enum: ["system", "user", "assistant"],
                      description: "Role of the message sender"
                    },
                    content: {
                      type: "string",
                      description: "Content of the message"
                    }
                  },
                  required: ["role", "content"]
                }
              },
              model: {
                type: "string",
                description: "Model to use for completion (default: deepseek-reasoner)"
              },
              temperature: {
                type: "number",
                minimum: 0,
                maximum: 2,
                description: "Sampling temperature (default: 0.7)"
              },
              max_tokens: {
                type: "integer",
                minimum: 1,
                description: "Maximum number of tokens to generate (default: 8000)"
              },
              top_p: {
                type: "number",
                minimum: 0,
                maximum: 1,
                description: "Nucleus sampling parameter (default: 1.0)"
              },
              frequency_penalty: {
                type: "number",
                minimum: -2,
                maximum: 2,
                description: "Penalty for token frequency (default: 0.1)"
              },
              presence_penalty: {
                type: "number",
                minimum: -2,
                maximum: 2,
                description: "Penalty for token presence (default: 0)"
              }
            },
            oneOf: [
              { required: ["message"] },
              { required: ["messages"] }
            ]
          }
        }]
      })
    );

    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request) => {
        if (request.params.name !== "chat_completion") {
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
        }

        const args = request.params.arguments as ChatCompletionArgs;
        let messages: ChatMessage[];

        // Handle simple message input
        if (typeof args?.message === 'string') {
          messages = [{ role: 'user', content: args.message }];
        } else if (Array.isArray(args?.messages)) {
          messages = args.messages;
        } else {
          throw new McpError(
            ErrorCode.InvalidParams,
            "Either 'message' or 'messages' must be provided"
          );
        }

        try {
          const response = await this.axiosInstance.post<DeepSeekResponse>(
            API_CONFIG.ENDPOINTS.CHAT,
            {
              messages,
              model: args?.model || API_CONFIG.DEFAULT_MODEL,
              temperature: args?.temperature ?? 0.7,
              max_tokens: args?.max_tokens ?? 8000,
              top_p: args?.top_p ?? 1,
              frequency_penalty: args?.frequency_penalty ?? 0.1,
              presence_penalty: args?.presence_penalty ?? 0
            }
          );

          return {
            content: [{
              type: "text",
              text: response.data.choices[0].message.content
            }]
          };
        } catch (error) {
          if (axios.isAxiosError(error)) {
            return {
              content: [{
                type: "text",
                text: `DeepSeek API error: ${error.response?.data?.error?.message ?? error.message}`
              }],
              isError: true
            };
          }
          throw error;
        }
      }
    );
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("DeepSeek MCP server running on stdio");
  }
}

const server = new DeepSeekServer();
server.run().catch(console.error);
