import { z } from 'zod';
import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

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
});

export type ModelConfig = z.infer<typeof ConfigSchema>;

export async function interpretConfigInstruction(
    instruction: string
): Promise<ModelConfig> {
    const config: ModelConfig = {
        model: 'deepseek-chat',
        temperature: 0.7,
        max_tokens: 8000,
        top_p: 1
    };

    const normalizedInstruction = instruction.toLowerCase();

    // Model selection
    if (normalizedInstruction.includes('reason')) {
        config.model = 'deepseek-reasoner';
    }

    // Temperature parsing
    if (normalizedInstruction.includes('temperature')) {
        if (normalizedInstruction.includes('high') || normalizedInstruction.includes('creative')) {
            config.temperature = 0.8;
        } else if (normalizedInstruction.includes('low') || normalizedInstruction.includes('precise')) {
            config.temperature = 0.2;
        }
    }

    // Token length parsing
    const tokenMatch = normalizedInstruction.match(/(\d+)\s*(tokens|length)/);
    if (tokenMatch) {
        config.max_tokens = Math.min(8000, Math.max(1, parseInt(tokenMatch[1])));
    }

    try {
        return ConfigSchema.parse(config);
    } catch (error) {
        throw new McpError(
            ErrorCode.InvalidRequest,
            'Invalid configuration parameters generated from instruction'
        );
    }
}