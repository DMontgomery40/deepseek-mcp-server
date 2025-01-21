import { z } from 'zod';
import type { DeepSeekResponse } from './types.js';

export const ConfigSchema = z.object({
    model: z.string()
        .default('deepseek-chat')
        .describe('Model identifier for DeepSeek API'),
    
    temperature: z.number()
        .min(0)
        .max(2)
        .default(0.7)
        .describe('Controls randomness in generation'),
    
    max_tokens: z.number()
        .min(1)
        .max(8000)
        .default(8000)
        .describe('Maximum tokens to generate'),
    
    top_p: z.number()
        .min(0)
        .max(1)
        .default(1)
        .describe('Nucleus sampling threshold'),
    
    frequency_penalty: z.number()
        .min(-2)
        .max(2)
        .default(0.1)
        .describe('Penalty for token frequency'),
    
    presence_penalty: z.number()
        .min(-2)
        .max(2)
        .default(0)
        .describe('Penalty for token presence')
}).partial();

export type ModelConfig = z.infer<typeof ConfigSchema>;

export async function interpretConfigInstruction(
    instruction: string
): Promise<ModelConfig> {
    // For now, just parse basic instructions
    const config: ModelConfig = {};
    
    if (instruction.toLowerCase().includes('temperature')) {
        if (instruction.includes('high') || instruction.includes('creative')) {
            config.temperature = 0.8;
        } else if (instruction.includes('low') || instruction.includes('precise')) {
            config.temperature = 0.2;
        }
    }
    
    if (instruction.toLowerCase().includes('tokens')) {
        const match = instruction.match(/(\d+)\s*tokens/);
        if (match) {
            config.max_tokens = Math.min(8000, Math.max(1, parseInt(match[1])));
        }
    }
    
    return config;
}