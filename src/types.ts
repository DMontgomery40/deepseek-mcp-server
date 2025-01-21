export interface DeepSeekResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string;
    };
    finish_reason: 'stop' | 'length' | 'content_filter';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionArgs {
  message?: string;
  messages?: ChatMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
}

// Type guard for chat completion arguments
export function isValidChatCompletionArgs(args: unknown): args is ChatCompletionArgs {
  if (!args || typeof args !== 'object') {
    return false;
  }

  const { message, messages, model, temperature, max_tokens, top_p, frequency_penalty, presence_penalty } = args as ChatCompletionArgs;

  // Must have either message or messages
  if (!message && !messages) {
    return false;
  }

  // If message is provided, it must be a string
  if (message !== undefined && typeof message !== 'string') {
    return false;
  }

  // If messages is provided, validate the array
  if (messages !== undefined) {
    if (!Array.isArray(messages)) {
      return false;
    }

    const validRoles = ['system', 'user', 'assistant'] as const;
    const isValidMessage = (msg: unknown): msg is ChatMessage => {
      if (!msg || typeof msg !== 'object') {
        return false;
      }
      const { role, content } = msg as ChatMessage;
      return (
        validRoles.includes(role as typeof validRoles[number]) &&
        typeof content === 'string'
      );
    };

    if (!messages.every(isValidMessage)) {
      return false;
    }
  }

  if (model !== undefined && typeof model !== 'string') {
    return false;
  }

  if (temperature !== undefined && (typeof temperature !== 'number' || temperature < 0 || temperature > 2)) {
    return false;
  }

  if (max_tokens !== undefined && (typeof max_tokens !== 'number' || max_tokens < 1)) {
    return false;
  }

  if (top_p !== undefined && (typeof top_p !== 'number' || top_p < 0 || top_p > 1)) {
    return false;
  }

  if (frequency_penalty !== undefined && (typeof frequency_penalty !== 'number' || frequency_penalty < -2 || frequency_penalty > 2)) {
    return false;
  }

  if (presence_penalty !== undefined && (typeof presence_penalty !== 'number' || presence_penalty < -2 || presence_penalty > 2)) {
    return false;
  }

  return true;
}
