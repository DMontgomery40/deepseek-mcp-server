export type DeepSeekModelId = "deepseek-v4-flash" | "deepseek-v4-pro" | string;

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatContentPartText {
  type: "text";
  text: string;
}

export interface DeepSeekFunctionCall {
  name: string;
  arguments: string;
}

export interface DeepSeekToolCall {
  id?: string;
  index?: number;
  type: "function";
  function: DeepSeekFunctionCall;
}

export interface DeepSeekChatMessage {
  role: ChatRole;
  content?: string | null;
  name?: string;
  tool_call_id?: string;
  prefix?: boolean;
  reasoning_content?: string;
  tool_calls?: DeepSeekToolCall[];
}

export interface DeepSeekToolDefinition {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
    strict?: boolean;
  };
}

export type DeepSeekToolChoice =
  | "none"
  | "auto"
  | "required"
  | {
      type: "function";
      function: {
        name: string;
      };
    };

export interface DeepSeekChatCompletionRequest {
  model: DeepSeekModelId;
  messages: DeepSeekChatMessage[];
  frequency_penalty?: number;
  max_tokens?: number;
  presence_penalty?: number;
  response_format?: {
    type: "text" | "json_object";
  };
  stop?: string | string[];
  stream?: boolean;
  stream_options?: Record<string, unknown>;
  temperature?: number;
  top_p?: number;
  tools?: DeepSeekToolDefinition[];
  tool_choice?: DeepSeekToolChoice;
  logprobs?: boolean;
  top_logprobs?: number;
  thinking?: {
    type?: "enabled" | "disabled";
  };
  reasoning_effort?: "high" | "max";
  [key: string]: unknown;
}

export interface DeepSeekCompletionRequest {
  model: DeepSeekModelId;
  prompt: string;
  suffix?: string;
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  logprobs?: number;
  echo?: boolean;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  [key: string]: unknown;
}

export interface DeepSeekUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
  completion_tokens_details?: {
    reasoning_tokens?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface DeepSeekChatCompletionChoice {
  index: number;
  message: {
    role: "assistant";
    content: string | null;
    reasoning_content?: string;
    tool_calls?: DeepSeekToolCall[];
  };
  finish_reason: string | null;
  logprobs?: unknown;
}

export interface DeepSeekChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: DeepSeekChatCompletionChoice[];
  usage?: DeepSeekUsage;
  system_fingerprint?: string;
  [key: string]: unknown;
}

export interface DeepSeekCompletionChoice {
  index: number;
  text: string;
  logprobs?: unknown;
  finish_reason: string | null;
}

export interface DeepSeekCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: DeepSeekCompletionChoice[];
  usage?: DeepSeekUsage;
  system_fingerprint?: string;
  [key: string]: unknown;
}

export interface DeepSeekModel {
  id: string;
  object: string;
  owned_by?: string;
  created?: number;
  [key: string]: unknown;
}

export interface DeepSeekListModelsResponse {
  object: string;
  data: DeepSeekModel[];
}

export interface DeepSeekBalanceInfo {
  currency: string;
  total_balance: string;
  granted_balance: string;
  topped_up_balance: string;
}

export interface DeepSeekUserBalanceResponse {
  is_available: boolean;
  balance_infos: DeepSeekBalanceInfo[];
}

export interface ChatCompletionExecutionResult {
  response: DeepSeekChatCompletionResponse;
  streamChunkCount?: number;
}

export interface CompletionExecutionResult {
  response: DeepSeekCompletionResponse;
  streamChunkCount?: number;
}
