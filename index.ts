#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import axios, { AxiosError } from 'axios';
import dotenv from 'dotenv';
import {
  ConfigSchema,
  ModelConfig,
  interpretConfigInstruction
} from './util.js';
import type { DeepSeekResponse } from './types.js';

// 1. Load environment variables
dotenv.config();
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
if (!DEEPSEEK_API_KEY) throw new Error('Missing DEEPSEEK_API_KEY');

// 2. Create Server
const server = new McpServer({
  name: 'deepseek-mcp-server',
  version: '1.1.0'
});

// 3. State Management
let modelConfig: ModelConfig = ConfigSchema.parse({});

// Add model configuration resource
server.resource(
  'model-configuration',
  'model-config://main',
  async (uri) => ({
    contents: [{
      uri: uri.href,
      text: JSON.stringify(modelConfig, null, 2)
    }]
  })
);

// 4. Add Tools
server.tool(
  'chat-completion',
  {
    messages: z.array(z.object({
      role: z.string(),
      content: z.string()
    })),
    temperature: z.number().optional(),
    max_tokens: z.number().optional()
  },
  async ({ messages, temperature, max_tokens }) => {
    try {
      const response = await axios.post<DeepSeekResponse>(
        'https://api.deepseek.com/v1/chat/completions',
        {
          messages,
          temperature,
          max_tokens,
          model: 'deepseek-chat'
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
        throw new Error(`API error: ${JSON.stringify(axiosError.response.data)}`);
      }
      throw error;
    }
  }
);

// Add configuration instruction tool
server.tool(
  'configure',
  { instruction: z.string() },
  async ({ instruction }) => {
    try {
      const newConfig = interpretConfigInstruction(instruction);
      modelConfig = ConfigSchema.parse(newConfig);
      return {
        content: [{
          type: 'text',
          text: `Configuration updated: ${JSON.stringify(modelConfig, null, 2)}`
        }]
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `Failed to update configuration: ${error}`
        }],
        isError: true
      };
    }
  }
);

// Handle uncaught errors
process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});