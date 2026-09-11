export type DeepSeekModelId =
  | "deepseek-flash"
  | "deepseek-v4-pro"
  | "deepseek-v4-flash"
  | "deepseek-v4-flash-vision-exp"
  | string;

export type ChatRole = "system" | "user" | "assistant" | "tool";

export type DeepSeekImageDetail = "low" | "high" | "original" | "auto";

export interface ChatContentPartText {
  type: "text";
  text: string;
}

export interface DeepSeekChatImageContentPart {
  type: "image_url";
  image_url: {
    url: string;
    detail?: DeepSeekImageDetail;
  };
}

export interface DeepSeekChatFileContentPart {
  type: "file";
  file_id?: string;
  file_data?: string;
  filename?: string;
}

export type DeepSeekChatContentPart =
  | ChatContentPartText
  | DeepSeekChatImageContentPart
  | DeepSeekChatFileContentPart;

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
  content?: string | DeepSeekChatContentPart[] | null;
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
  reasoning_effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  user_id?: string;
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

export interface DeepSeekResponseTextContentPart {
  type: "input_text" | "output_text";
  text: string;
  [key: string]: unknown;
}

export interface DeepSeekResponseImageContentPart {
  type: "input_image";
  image_url?: string;
  file_id?: string;
  detail?: DeepSeekImageDetail;
  [key: string]: unknown;
}

export interface DeepSeekResponseReasoningContentPart {
  type: "reasoning_text";
  text: string;
  [key: string]: unknown;
}

export type DeepSeekResponseInputContentPart =
  | DeepSeekResponseTextContentPart
  | DeepSeekResponseImageContentPart;

export type DeepSeekResponseInputItem =
  | {
      type?: "message";
      role: "user" | "assistant" | "system" | "developer";
      content: string | DeepSeekResponseInputContentPart[];
      [key: string]: unknown;
    }
  | {
      type: "function_call";
      call_id: string;
      name: string;
      arguments: string;
      [key: string]: unknown;
    }
  | {
      type: "function_call_output";
      call_id: string;
      output: string | DeepSeekResponseInputContentPart[];
      [key: string]: unknown;
    }
  | {
      type: "custom_tool_call";
      call_id: string;
      name: string;
      input: string;
      [key: string]: unknown;
    }
  | {
      type: "custom_tool_call_output";
      call_id: string;
      output: string | DeepSeekResponseInputContentPart[];
      [key: string]: unknown;
    }
  | {
      type: "reasoning";
      content: DeepSeekResponseReasoningContentPart[];
      [key: string]: unknown;
    }
  | {
      type: "web_search_call";
      [key: string]: unknown;
    };

export interface DeepSeekResponseRequest {
  model: DeepSeekModelId;
  input?: string | DeepSeekResponseInputItem[];
  instructions?: string;
  reasoning?: {
    effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
  };
  max_output_tokens?: number;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  text?: Record<string, unknown>;
  tools?: Array<Record<string, unknown>>;
  tool_choice?: string | Record<string, unknown>;
  top_logprobs?: number;
  user?: string;
  [key: string]: unknown;
}

export interface DeepSeekResponseOutputContent {
  type: "output_text" | "reasoning_text" | string;
  text?: string;
  [key: string]: unknown;
}

export interface DeepSeekResponseOutputItem {
  type: "message" | "reasoning" | "function_call" | "web_search_call" | string;
  id?: string;
  status?: "in_progress" | "completed" | "incomplete" | string;
  role?: "assistant";
  content?: DeepSeekResponseOutputContent[];
  call_id?: string;
  name?: string;
  arguments?: string;
  action?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DeepSeekResponse {
  id: string;
  object: "response" | string;
  created_at: number;
  status: "in_progress" | "completed" | "incomplete" | "failed" | string;
  model: string;
  output: DeepSeekResponseOutputItem[];
  usage?: Record<string, unknown>;
  error?: Record<string, unknown> | null;
  incomplete_details?: Record<string, unknown> | null;
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

export interface DeepSeekFile {
  id: string;
  object: "file";
  bytes: number;
  created_at: number;
  filename: string;
  purpose: "user_data";
  expires_at?: number;
  [key: string]: unknown;
}

export interface DeepSeekFileList {
  object: "list";
  data: DeepSeekFile[];
  first_id?: string;
  last_id?: string;
  has_more: boolean;
  [key: string]: unknown;
}

export interface DeepSeekFileDeletion {
  id: string;
  object: "file";
  deleted: boolean;
  [key: string]: unknown;
}

export interface DeepSeekUploadFileRequest {
  filename: string;
  fileData: string;
  expiresAfterSeconds?: number;
}

export interface DeepSeekListFilesRequest {
  after?: string;
  limit?: number;
  order?: "asc" | "desc";
  purpose?: "user_data";
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

export interface ResponseExecutionResult {
  response: DeepSeekResponse;
  streamEventCount?: number;
}
