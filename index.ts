#!/usr/bin/env node
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ServerCapabilities, ErrorCode, McpError, ListPromptsRequestSchema, GetPromptRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { array, boolean, optional, string, z, literal } from 'zod';
import axios, { AxiosError } from 'axios';
import * as dotenv from 'dotenv';
import { ConfigSchema, ModelConfig, interpretConfigInstruction } from './util.js';
import type { DeepSeekResponse, ModelsResponse } from './types.js';

// Load environment variables
dotenv.config();
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
if (!DEEPSEEK_API_KEY) throw new McpError(ErrorCode.InvalidRequest, 'Missing DEEPSEEK_API_KEY');

// Configure server capabilities
const capabilities: ServerCapabilities = {
  resources: { enabled: true },
  tools: { enabled: true },
  prompts: { 
    enabled: true,
    templates: ['system', 'chat'],
    defaultTemplate: 'chat'
  }
};


const transport = new StdioServerTransport();
await server.connect(transport);
console.log('Connected to server');

// Define available prompts
const PROMPTS = {
  "system": {
    name: "system",
    description: "Set system behavior for the AI",
    arguments: [
      {
        name: "content",
        description: "System instruction",
        required: true
      },
      {
        name: "temperature",
        description: "Response temperature (0-1)",
        required: false
      }
    ]
  },
  "chat": {
    name: "chat",
    description: "Chat with the AI",
    arguments: [
      {
        name: "content",
        description: "User message",
        required: true
      },
      {
        name: "history",
        description: "Previous conversation messages",
        required: false
      },
      {
        name: "temperature",
        description: "Response temperature (0-1)",
        required: false
      },
      {
        name: "shouldSummarize",
        description: "Whether to summarize the conversation",
        required: false
      }
    ]
  }
};

// Create Server
const server = new McpServer({
  name: 'deepseek-mcp-server',
  version: '1.1.0',
  capabilities
});

// List available prompts handler
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: Object.values(PROMPTS)
  };
});

// Get specific prompt handler
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const prompt = PROMPTS[request.params.name];
  if (!prompt) {
    throw new McpError(ErrorCode.InvalidRequest, `Prompt not found: ${request.params.name}`);
  }

  const args = request.params.arguments || {};

  if (request.params.name === "system") {
    if (!args.content) {
      throw new McpError(ErrorCode.InvalidRequest, "System prompt requires content argument");
    }

    return {
      messages: [
        {
          role: 'system',
          content: {
            type: 'text',
            text: args.content
          }
        }
      ],
      temperature: args.temperature
    };
  }

  if (request.params.name === "chat") {
    if (!args.content) {
      throw new McpError(ErrorCode.InvalidRequest, "Chat prompt requires content argument");
    }

    const messages = [
      ...(args.history || []),
      {
        role: 'user',
        content: {
          type: 'text',
          text: args.content
        }
      }
    ];

    if (args.shouldSummarize) {
      messages.push({
        role: 'user',
        content: {
          type: 'text',
          text: 'Please summarize our conversation into key points needed for continuing the discussion.'
        }
      });
    }

    return {
      messages,
      temperature: args.temperature ?? modelConfig.temperature
    };
  }

  throw new McpError(ErrorCode.InternalError, "Prompt implementation not found");
});


const client = new McpClient({
  awwa: {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/client-awwa', 'http://localhost:3000']
  }
});


// State Management
let modelConfig: ModelConfig = ConfigSchema.parse({});

// Define Message Schema
const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.object({
    type: z.literal('text'),
    text: z.string()
  })
});

// 1. Register RESOURCES first (they provide data)
server.resource(
  'model-configuration',
  new ResourceTemplate('model-config://main', {
    list: undefined
  }),
  async (uri: URL) => ({
    contents: [{
      uri: uri.href,
      text: JSON.stringify({
        type: 'model-config',
        data: modelConfig
      })
    }]
  })
);

server.resource(
  'models',
  'models://list',
  async (uri: URL) => {
    try {
      const response = await axios.get<ModelsResponse>(
        'https://api.deepseek.com/models',
        {
          headers: {
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      return {
        contents: [{
          uri: uri.href,
          text: JSON.stringify(response.data, null, 2)
        }]
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `API error: ${JSON.stringify(axiosError.response.data)}`
        );
      }
      throw new McpError(ErrorCode.InternalError, 'Failed to fetch models list');
    }
  }
);

// 2. Register TOOLS second (they perform actions)
server.tool(
  'chat-completion',
  {
    messages: z.array(MessageSchema),
    temperature: z.number().optional(),
    max_tokens: z.number().optional(),
    stop: z.array(z.string()).optional()
  },
  async ({ messages, temperature, max_tokens, stop }) => {
    try {
      const isReasoner = modelConfig.model?.includes('reasoner');
      const payload: Record<string, any> = {
        messages,
        model: modelConfig.model || 'deepseek-reasoner',
        max_tokens: max_tokens ?? modelConfig.max_tokens,
        stop
      };

      if (!isReasoner) {
        payload.temperature = temperature ?? modelConfig.temperature;
      }

      const response = await axios.post<DeepSeekResponse>(
        'https://api.deepseek.com/v1/chat/completions',
        payload,
        {
          headers: {
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const result = response.data.choices[0].message;
      return {
        content: [{
          type: 'text',
          text: result.content,
          ...(result.reasoning_content && { metadata: { reasoning: result.reasoning_content } })
        }]
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `DeepSeek API error: ${axiosError.response.status} ${axiosError.response.statusText}`
        );
      }
      throw error;
    }
  }
);

server.tool(
  'configure',
  { instruction: z.string() },
  async ({ instruction }: { instruction: string }) => {
    try {
      const newConfig = await interpretConfigInstruction(instruction);
      modelConfig = ConfigSchema.parse(newConfig);
      return {
        content: [{
          type: 'text',
          text: `Configuration updated:\n${JSON.stringify(modelConfig, null, 2)}`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Configuration error: ${error instanceof Error ? error.message : String(error)}`
        }],
        error: new McpError(ErrorCode.InvalidRequest, 'Invalid configuration instruction')
      };
    }
  }
);

server.tool(
  'multi-round-chat',
  {
    messages: z.array(MessageSchema),
    temperature: z.number().optional(),
    shouldSummarize: z.boolean().optional()
  },
  async ({ messages, temperature, shouldSummarize = false }) => {
    try {
      const isReasoner = modelConfig.model?.includes('reasoner');

      if (shouldSummarize) {
        const summaryResponse = await axios.post<DeepSeekResponse>(
          'https://api.deepseek.com/v1/chat/completions',
          {
            messages: [...messages, {
              role: 'user',
              content: {
                type: 'text',
                text: 'Please summarize our conversation into key points needed for continuing the discussion.'
              }
            }],
            model: modelConfig.model,
            temperature: 0.3,
            max_tokens: modelConfig.max_tokens
          },
          {
            headers: {
              'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );

        const summary = summaryResponse.data.choices[0].message;
        return {
          content: [{
            type: 'text',
            text: summary.content,
            ...(summary.reasoning_content && { metadata: { reasoning: summary.reasoning_content } })
          }]
        };
      }

      const payload: Record<string, any> = {
        messages,
        model: modelConfig.model,
        max_tokens: modelConfig.max_tokens
      };

      if (!isReasoner) {
        payload.temperature = temperature ?? modelConfig.temperature;
      }

      const response = await axios.post<DeepSeekResponse>(
        'https://api.deepseek.com/v1/chat/completions',
        payload,
        {
          headers: {
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const result = response.data.choices[0].message;
      return {
        content: [{
          type: 'text',
          text: result.content,
          ...(result.reasoning_content && { metadata: { reasoning: result.reasoning_content } })
        }]
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `API error: ${JSON.stringify(axiosError.response.data)}`
        );
      }
      throw new McpError(ErrorCode.InternalError, 'Failed to process chat request');
    }
  }
);

server.tool(
  'continue-conversation',
  {
    previousMessages: z.array(MessageSchema),
    newQuestion: z.string(),
    shouldSummarize: z.boolean().optional()
  },
  async ({ previousMessages, newQuestion, shouldSummarize = false }) => {
    try {
      if (shouldSummarize) {
        const summaryResponse = await axios.post<DeepSeekResponse>(
          'https://api.deepseek.com/v1/chat/completions',
          {
            messages: [
              ...previousMessages,
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: 'Please summarize our conversation so far into key points.'
                }
              }
            ],
            model: modelConfig.model,
            temperature: 0.3
          },
          {
            headers: {
              'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );

        const summary = summaryResponse.data.choices[0].message;
        return {
          content: [{
            type: 'text',
            text: `Previous conversation summary: ${summary.content}`
          }]
        };
      }

      const response = await axios.post<DeepSeekResponse>(
        'https://api.deepseek.com/v1/chat/completions',
        {
          messages: [...previousMessages, { role: 'user', content: { type: 'text', text: newQuestion } }],
          model: modelConfig.model,
          temperature: modelConfig.temperature
        },
        {
          headers: {
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const result = response.data.choices[0].message;
      return {
        content: [{
          type: 'text',
          text: result.content
        }]
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `API error: ${JSON.stringify(axiosError.response.data)}`
        );
      }
      throw new McpError(ErrorCode.InternalError, 'Failed to process conversation');
    }
  }
);

// 3. Register PROMPTS last (they're templates for LLM interaction)
server.prompt(
  'system',  // Handler for system prompts
  {
    content: z.string(),
    temperature: z.number().optional(),
    stop: z.array(z.string()).optional()
  },
  async ({ content, temperature, stop }) => {
    const messages = [{
      role: 'system',
      content: { type: 'text', text: content }
    }];
    
    return { messages, stop };
  }
);

server.prompt(
  'chat',  // Handler for chat interactions
  {
    content: z.string(),
    history: z.array(MessageSchema).optional(),
    temperature: z.number().optional(),
    shouldSummarize: z.boolean().optional(),
    stop: z.array(z.string()).optional()
  },
  async ({ content, history = [], temperature, shouldSummarize = false, stop }) => {
    try {
      const messages = [
        ...history,
        {
          role: 'user',
          content: { type: 'text', text: content }
        }
      ];

      if (shouldSummarize) {
        messages.push({
          role: 'user',
          content: {
            type: 'text',
            text: 'Please summarize our conversation into key points needed for continuing the discussion.'
          }
        });
      }

      return {
        messages,
        temperature: temperature ?? modelConfig.temperature,
        stop
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to process chat prompt: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
);

server.prompt(
  'chat',  // Handler for chat interactions
  {
    content: z.string(),
    history: z.array(MessageSchema).optional(),
    temperature: z.number().optional(),
    shouldSummarize: z.boolean().optional(),
    stop: z.array(z.string()).optional()
  },
  async ({ type, content, messages = [], temperature, shouldSummarize = false, stopSequences }) => {
    try {
      const isReasoner = modelConfig.model?.includes('reasoner');

      // Handle system prompts
      if (type === 'system') {
        return {
          messages: [{
            role: 'system',
            content  // Content is already in the right format
          }],
          stop: stopSequences
        };
      }

      // Handle chat interactions
      if (shouldSummarize) {
        const summaryResponse = await axios.post<DeepSeekResponse>(
          'https://api.deepseek.com/v1/chat/completions',
          {
            messages: [...messages, {
              role: 'user',
              content: {
                type: 'text',
                text: 'Please summarize our conversation into key points needed for continuing the discussion.'
              }
            }],
            model: modelConfig.model,
            temperature: 0.3,
            max_tokens: modelConfig.max_tokens
          },
          {
            headers: {
              'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        );

        const summary = summaryResponse.data.choices[0].message;
        return {
          content: [{
            type: 'text',
            text: summary.content,
            ...(summary.reasoning_content && { metadata: { reasoning: summary.reasoning_content } })
          }]
        };
      }

      const payload: Record<string, any> = {
        messages: [...messages, { role: 'user', content }],  // Content is already in the right format
        model: modelConfig.model,
        max_tokens: modelConfig.max_tokens
      };

      if (!isReasoner) {
        payload.temperature = temperature ?? modelConfig.temperature;
      }

      const response = await axios.post<DeepSeekResponse>(
        'https://api.deepseek.com/v1/chat/completions',
        payload,
        {
          headers: {
            'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const result = response.data.choices[0].message;
      return {
        content: [{
          type: 'text',
          text: result.content,
          ...(result.reasoning_content && { metadata: { reasoning: result.reasoning_content } })
        }]
      };
    } catch (error) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        throw new McpError(
          ErrorCode.InvalidRequest,
          `API error: ${JSON.stringify(axiosError.response.data)}`
        );
      }
      throw new McpError(ErrorCode.InternalError, 'Failed to process request');
    }
  }
);

// Configure Transport
const transport = new StdioServerTransport();

// Error Handling
process.on('uncaughtException', (error: Error) => {
  process.stderr.write(`Uncaught exception: ${error.stack ?? error.message}\n`);
  process.exit(1);
});

process.on('unhandledRejection', (reason: unknown) => {
  process.stderr.write(`Unhandled rejection: ${reason instanceof Error ? reason.stack : String(reason)}\n`);
  process.exit(1);
});

// Initialize prompt templates
const systemTemplate = {
  type: 'system',
  content: {
    type: 'text' as const,
    text: ''
  }
};

const chatTemplate = {
  type: 'chat',
  content: {
    type: 'text' as const,
    text: ''
  },
  messages: []
};

// Set up prompt templates before connecting
server.setPromptTemplates({
  system: systemTemplate,
  chat: chatTemplate
});

// Connect server
server.connect(transport).catch((error: Error) => {
  process.stderr.write(`Transport error: ${error.stack ?? error.message}\n`);
  process.exit(1);
});