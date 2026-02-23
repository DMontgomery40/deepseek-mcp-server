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
    stream_options: z.record(z.string(), z.unknown()).optional(),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    tools: z.array(z.record(z.string(), z.unknown())).optional(),
    tool_choice: z.union([z.enum(["none", "auto", "required"]), z.record(z.string(), z.unknown())]).optional(),
    logprobs: z.boolean().optional(),
    top_logprobs: z.number().int().min(0).max(20).optional(),
    thinking: z.record(z.string(), z.unknown()).optional(),
    modalities: z.array(z.string().min(1)).optional(),
    audio: z.record(z.string(), z.unknown()).optional(),
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
  extra_body: z.record(z.string(), z.unknown()).optional(),
});

export const resetConversationToolInputSchema = z.object({
  conversation_id: z.string().min(1),
});

export type ChatCompletionToolInput = z.infer<typeof chatCompletionToolInputSchema>;
export type CompletionToolInput = z.infer<typeof completionToolInputSchema>;
export type ResetConversationToolInput = z.infer<typeof resetConversationToolInputSchema>;
