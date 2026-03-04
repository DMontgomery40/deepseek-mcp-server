import { z } from "zod";

export const chatMessageSchema = z
  .object({
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: z.union([z.string(), z.array(z.unknown()), z.null()]).optional(),
    name: z.string().optional(),
    tool_call_id: z.string().optional(),
    prefix: z.boolean().optional(),
    reasoning_content: z.string().optional(),
    tool_calls: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough();

const stopSchema = z.union([z.string().min(1), z.array(z.string().min(1)).min(1).max(16)]);

const streamOptionsSchema = z
  .object({
    include_usage: z.boolean().optional(),
  })
  .passthrough();

const toolFunctionSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    strict: z.boolean().optional(),
  })
  .passthrough();

const toolDefinitionSchema = z
  .object({
    type: z.literal("function"),
    function: toolFunctionSchema,
  })
  .passthrough();

const toolChoiceSchema = z.union([
  z.enum(["none", "auto", "required"]),
  z
    .object({
      type: z.literal("function"),
      function: z
        .object({
          name: z.string().min(1),
        })
        .passthrough(),
    })
    .passthrough(),
]);

const thinkingSchema = z
  .object({
    type: z.enum(["enabled", "disabled"]).optional(),
  })
  .passthrough();

const audioSchema = z
  .object({
    format: z.string().min(1).optional(),
    voice: z.string().min(1).optional(),
  })
  .passthrough();

export const emptyToolInputSchema = z.object({});

export const chatCompletionToolInputSchema = z
  .object({
    message: z.string().min(1).optional(),
    messages: z.array(chatMessageSchema).min(1).optional(),
    model: z.string().default("deepseek-chat"),
    conversation_id: z.string().min(1).optional(),
    clear_conversation: z.boolean().default(false),
    frequency_penalty: z.number().min(-2).max(2).optional(),
    max_tokens: z.number().int().positive().optional(),
    max_completion_tokens: z.number().int().positive().optional(),
    presence_penalty: z.number().min(-2).max(2).optional(),
    response_format: z
      .object({
        type: z.enum(["text", "json_object"]),
      })
      .passthrough()
      .optional(),
    stop: stopSchema.optional(),
    stream: z.boolean().default(false),
    stream_options: streamOptionsSchema.optional(),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    tools: z.array(toolDefinitionSchema).optional(),
    tool_choice: toolChoiceSchema.optional(),
    logprobs: z.boolean().optional(),
    top_logprobs: z.number().int().min(0).max(20).optional(),
    thinking: thinkingSchema.optional(),
    modalities: z.array(z.string().min(1)).optional(),
    audio: audioSchema.optional(),
    include_raw_response: z.boolean().default(false),
    extra_body: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((value, context) => {
    if (!value.message && !value.messages) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Either `message` or `messages` must be provided",
      });
    }

    if (value.top_logprobs !== undefined && !value.logprobs) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "`top_logprobs` requires `logprobs=true`",
      });
    }
  });

export const completionToolInputSchema = z.object({
  model: z.string().default("deepseek-chat"),
  prompt: z.string().min(1),
  suffix: z.string().optional(),
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  n: z.number().int().positive().optional(),
  stream: z.boolean().default(false),
  logprobs: z.number().int().min(0).max(20).optional(),
  echo: z.boolean().optional(),
  stop: stopSchema.optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  best_of: z.number().int().positive().optional(),
  include_raw_response: z.boolean().default(false),
  extra_body: z.record(z.string(), z.unknown()).optional(),
});

const uploadToolInputBaseSchema = z
  .object({
    file_url: z.string().url().optional(),
    file_base64: z.string().min(1).optional(),
    mime_type: z.string().min(1).optional(),
    filename: z.string().min(1).optional(),
    purpose: z.string().min(1).optional(),
    model: z.string().optional(),
    include_raw_response: z.boolean().default(false),
    extra_body: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((value, context) => {
    if (!value.file_url && !value.file_base64) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Either `file_url` or `file_base64` must be provided",
      });
    }
  });

export const visionUploadToolInputSchema = uploadToolInputBaseSchema.extend({});

export const videoUploadToolInputSchema = uploadToolInputBaseSchema.extend({});

export const imageGenerationToolInputSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
  size: z.string().min(1).optional(),
  n: z.number().int().positive().max(8).optional(),
  response_format: z.enum(["url", "b64_json"]).optional(),
  quality: z.string().min(1).optional(),
  style: z.string().min(1).optional(),
  seed: z.number().int().optional(),
  include_raw_response: z.boolean().default(false),
  extra_body: z.record(z.string(), z.unknown()).optional(),
});

export const videoGenerationToolInputSchema = z.object({
  prompt: z.string().min(1),
  model: z.string().optional(),
  duration_seconds: z.number().positive().max(120).optional(),
  resolution: z.string().min(1).optional(),
  fps: z.number().positive().max(120).optional(),
  seed: z.number().int().optional(),
  image_url: z.string().url().optional(),
  n: z.number().int().positive().max(4).optional(),
  wait_for_completion: z.boolean().default(false),
  poll_interval_ms: z.number().int().positive().max(60000).default(3000),
  max_wait_ms: z.number().int().positive().max(300000).default(60000),
  max_stall_polls: z.number().int().positive().max(100).default(12),
  include_raw_response: z.boolean().default(false),
  extra_body: z.record(z.string(), z.unknown()).optional(),
});

export const resetConversationToolInputSchema = z.object({
  conversation_id: z.string().min(1),
});

export type ChatCompletionToolInput = z.infer<typeof chatCompletionToolInputSchema>;
export type CompletionToolInput = z.infer<typeof completionToolInputSchema>;
export type ResetConversationToolInput = z.infer<typeof resetConversationToolInputSchema>;
export type VisionUploadToolInput = z.infer<typeof visionUploadToolInputSchema>;
export type VideoUploadToolInput = z.infer<typeof videoUploadToolInputSchema>;
export type ImageGenerationToolInput = z.infer<typeof imageGenerationToolInputSchema>;
export type VideoGenerationToolInput = z.infer<typeof videoGenerationToolInputSchema>;
