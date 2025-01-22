#!/usr/bin/env node
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ServerCapabilities, ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import axios, { AxiosError } from 'axios';
import * as dotenv from 'dotenv';
import { ConfigSchema, ModelConfig, interpretConfigInstruction } from './util.js';
import type { DeepSeekResponse } from './types.js';

// 1. Load environment variables
dotenv.config();
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
if (!DEEPSEEK_API_KEY) throw new McpError(ErrorCode.InvalidRequest, 'Missing DEEPSEEK_API_KEY');

// 2. Configure server capabilities
const capabilities: ServerCapabilities = {
  resources: { enabled: true },
  tools: { enabled: true },
  prompts: { enabled: false }
};

// 3. Create Server
const server = new McpServer({
  name: 'deepseek-mcp-server',
  version: '1.1.0',
  capabilities
});

// 4. State Management
let modelConfig: ModelConfig = ConfigSchema.parse({});

// 5. Define Message Schema
const MessageSchema = z.object({
  role: z.enum(['system', 'user', 'assistant']),
  content: z.string()
});

// 6. Add Resources
server.resource(
  'model-configuration',
  new ResourceTemplate('model-config://main', {
    list: undefined,
    complete: {
      'model-config': async (template) => {
        const config = ConfigSchema.parse(template);
        return [JSON.stringify(config)];
      }
    }
  }),
  async (uri: URL) => ({
    contents: [{
      uri: uri.href,
      text: JSON.stringify({
        type: 'model-config',
        data: {
          model: 'deepseek-coder-33b-instruct',
          temperature: 0.7,
          max_tokens: 2048,
          top_p: 0.95
        }
      })
    }]
  })
);

// 7. Add Tools
server.tool(
  'chat-completion',
  {
    messages: z.array(MessageSchema),
    temperature: z.number().optional(),
    max_tokens: z.number().optional()
  },
  async ({ messages, temperature, max_tokens }: {
    messages: Array<{ role: string, content: string }>,
    temperature?: number,
    max_tokens?: number
  }) => {
    try {
      const response = await axios.post<DeepSeekResponse>(
        'https://api.deepseek.com/v1/chat/completions',
        {
          messages,
          temperature: temperature ?? modelConfig.temperature,
          max_tokens: max_tokens ?? modelConfig.max_tokens,
          model: modelConfig.model ?? 'deepseek-chat'
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
          type: 'text',
          text: response.data.choices[0].message.content
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
      throw new McpError(ErrorCode.InternalError, 'Failed to reach DeepSeek API');
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

// 8. Configure Transport
const transport = new StdioServerTransport();
server.connect(transport).catch((error: Error) => {
  process.stderr.write(`Transport error: ${error}\n`);
  process.exit(1);
});

// 9. Error Handling
process.on('uncaughtException', (error: Error) => {
  process.stderr.write(`Uncaught exception: ${error}\n`);
  process.exit(1);
});