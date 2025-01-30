#!/usr/bin/env node
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import axios, { AxiosInstance, AxiosResponse, AxiosError } from 'axios';
import dotenv from "dotenv";
import { 
  DeepSeekResponse,
  ChatMessage,
  ModelInfo,
  ModelConfig
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

const MODELS: ModelInfo[] = [
  {
    id: "deepseek-chat",
    name: "DeepSeek Chat",
    description: "General-purpose chat model optimized for dialogue"
  },
  {
    id: "deepseek-reasoner",
    name: "DeepSeek Reasoner",
    description: "Model optimized for reasoning and problem-solving"
  }
];

const MODEL_CONFIGS: ModelConfig[] = [
  {
    id: "temperature",
    name: "Temperature",
    type: "number",
    description: "Controls randomness in the output (0.0 to 2.0)",
    default: 0.7,
    minimum: 0,
    maximum: 2
  },
  {
    id: "max_tokens",
    name: "Maximum Tokens",
    type: "integer",
    description: "Maximum number of tokens to generate",
    default: 8000,
    minimum: 1
  },
  {
    id: "top_p",
    name: "Top P",
    type: "number",
    description: "Controls diversity via nucleus sampling (0.0 to 1.0)",
    default: 1.0,
    minimum: 0,
    maximum: 1
  },
  {
    id: "frequency_penalty",
    name: "Frequency Penalty",
    type: "number",
    description: "Reduces repetition by penalizing frequent tokens (-2.0 to 2.0)",
    default: 0.1,
    minimum: -2,
    maximum: 2
  },
  {
    id: "presence_penalty",
    name: "Presence Penalty",
    type: "number",
    description: "Reduces repetition by penalizing used tokens (-2.0 to 2.0)",
    default: 0,
    minimum: -2,
    maximum: 2
  }
];

class DeepSeekServer {
  private server: McpServer;
  private axiosInstance: AxiosInstance;
  private conversationHistory: ChatMessage[] = [];

  constructor() {
    this.server = new McpServer({
      name: "deepseek-mcp-server",
      version: "0.1.0"
    });

    this.axiosInstance = axios.create({
      baseURL: API_CONFIG.BASE_URL,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    // Set up error handling first
    this.setupErrorHandling();
    
    // Then set up resources and tools
    this.setupResources();
    this.setupTools();
  }

  private setupErrorHandling(): void {
    // Handle API errors
    this.axiosInstance.interceptors.response.use(
      (response: AxiosResponse) => response,
      (error: AxiosError) => {
        console.error("[API Error]", error.response?.data || error.message);
        throw error;
      }
    );

    // Handle process termination
    process.on('SIGINT', async () => {
      console.error("Shutting down...");
      await this.server.close();
      process.exit(0);
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      console.error("[Uncaught Exception]", error);
      process.exit(1);
    });
  }

  private setupResources(): void {
    // Models resource
    this.server.resource(
      "models",
      new ResourceTemplate("models://{modelId}", { 
        list: async () => ({
          resources: MODELS.map(model => ({
            uri: `models://${model.id}`,
            name: model.name,
            description: model.description
          }))
        })
      }),
      async (uri, { modelId }) => ({
        contents: [{
          uri: uri.href,
          text: JSON.stringify(MODELS.find(m => m.id === modelId), null, 2)
        }]
      })
    );

    // Model config resource
    this.server.resource(
      "model-config",
      new ResourceTemplate("config://{modelId}", {
        list: async () => ({
          resources: MODEL_CONFIGS.map(config => ({
            uri: `config://${config.id}`,
            name: config.name,
            description: config.description
          }))
        })
      }),
      async (uri, { modelId }) => ({
        contents: MODEL_CONFIGS.map(config => ({
          uri: `config://${modelId}/${config.id}`,
          text: JSON.stringify(config, null, 2)
        }))
      })
    );
  }

  private setupTools(): void {
    // Chat completion tool
    this.server.tool(
      "chat_completion",
      {
        message: z.string().optional(),
        messages: z.array(z.object({
          role: z.enum(['system', 'user', 'assistant']),
          content: z.string()
        })).optional(),
        model: z.string().default('deepseek-reasoner'),
        temperature: z.number().min(0).max(2).default(0.7),
        max_tokens: z.number().positive().int().default(8000),
        top_p: z.number().min(0).max(1).default(1.0),
        frequency_penalty: z.number().min(-2).max(2).default(0.1),
        presence_penalty: z.number().min(-2).max(2).default(0)
      },
      async (args) => {
        let messages: ChatMessage[];
        if (args.message) {
          messages = [{ role: 'user', content: args.message }];
        } else if (args.messages) {
          messages = args.messages;
        } else {
          throw new Error("Either 'message' or 'messages' must be provided");
        }

        try {
          const response = await this.axiosInstance.post<DeepSeekResponse>(
            API_CONFIG.ENDPOINTS.CHAT,
            {
              messages,
              model: args.model,
              temperature: args.temperature,
              max_tokens: args.max_tokens,
              top_p: args.top_p,
              frequency_penalty: args.frequency_penalty,
              presence_penalty: args.presence_penalty
            }
          );

          return {
            content: [{
              type: "text",
              text: response.data.choices[0].message.content
            }]
          };
        } catch (error) {
          console.error("Error with deepseek-reasoner, falling back to deepseek-chat");
          
          try {
            const fallbackResponse = await this.axiosInstance.post<DeepSeekResponse>(
              API_CONFIG.ENDPOINTS.CHAT,
              {
                messages,
                model: 'deepseek-chat',
                temperature: args.temperature,
                max_tokens: args.max_tokens,
                top_p: args.top_p,
                frequency_penalty: args.frequency_penalty,
                presence_penalty: args.presence_penalty
              }
            );

            return {
              content: [{
                type: "text",
                text: "Note: Fallback to deepseek-chat due to reasoner error.\n\n" + 
                      fallbackResponse.data.choices[0].message.content
              }]
            };
          } catch (fallbackError) {
            if (axios.isAxiosError(fallbackError)) {
              throw new Error(`DeepSeek API error: ${fallbackError.response?.data?.error?.message ?? fallbackError.message}`);
            }
            throw fallbackError;
          }
        }
      }
    );

    // Multi-turn chat tool
    this.server.tool(
      "multi_turn_chat",
      {
        messages: z.union([
          z.string(),
          z.array(z.object({
            role: z.enum(['system', 'user', 'assistant']),
            content: z.object({
              type: z.literal('text'),
              text: z.string()
            })
          }))
        ]).transform(messages => {
          if (typeof messages === 'string') {
            return [{
              role: 'user' as const,
              content: {
                type: 'text' as const,
                text: messages
              }
            }];
          }
          return messages;
        }),
        model: z.string().default('deepseek-chat'),
        temperature: z.number().min(0).max(2).default(0.7),
        max_tokens: z.number().positive().int().default(8000),
        top_p: z.number().min(0).max(1).default(1.0),
        frequency_penalty: z.number().min(-2).max(2).default(0.1),
        presence_penalty: z.number().min(-2).max(2).default(0)
      },
      async (args) => {
        try {
          // Transform new messages
          const newMessage = args.messages[0];
          const transformedNewMessage = {
            role: newMessage.role,
            content: newMessage.content.text
          };

          // Add new message to history
          this.conversationHistory.push(transformedNewMessage);

          // Transform all messages for API
          const transformedMessages = this.conversationHistory.map(msg => ({
            role: msg.role,
            content: msg.content
          }));

          const response = await this.axiosInstance.post<DeepSeekResponse>(
            API_CONFIG.ENDPOINTS.CHAT,
            {
              messages: transformedMessages,
              model: args.model,
              temperature: args.temperature,
              max_tokens: args.max_tokens,
              top_p: args.top_p,
              frequency_penalty: args.frequency_penalty,
              presence_penalty: args.presence_penalty
            }
          );

          // Add assistant's response to history
          const assistantMessage = {
            role: 'assistant' as const,
            content: response.data.choices[0].message.content
          };
          this.conversationHistory.push(assistantMessage);

          return {
            content: [{
              type: "text",
              text: assistantMessage.content
            }]
          };
        } catch (error) {
          if (axios.isAxiosError(error)) {
            throw new Error(`DeepSeek API error: ${error.response?.data?.error?.message ?? error.message}`);
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