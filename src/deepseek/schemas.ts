import { z } from "zod";

export const chatMessageSchema = z
  .object({
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: z.union([z.string(), z.null()]).optional(),
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
  .strict();

const responseMessageContentPartSchema = z.union([
  z
    .object({
      type: z.literal("input_text"),
      text: z.string().min(1),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("output_text"),
      text: z.string().min(1),
    })
    .passthrough(),
]);

const responseReasoningContentPartSchema = z
  .object({
    type: z.literal("reasoning_text"),
    text: z.string().min(1),
  })
  .passthrough();

const responseInputItemSchema = z.union([
  z
    .object({
      type: z.literal("message").optional(),
      role: z.enum(["user", "assistant", "system", "developer"]),
      content: z.union([z.string(), z.array(responseMessageContentPartSchema).min(1)]),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("function_call"),
      call_id: z.string().min(1),
      name: z.string().min(1),
      arguments: z.string(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("function_call_output"),
      call_id: z.string().min(1),
      output: z.string(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("reasoning"),
      content: z.array(responseReasoningContentPartSchema).min(1),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("web_search_call"),
    })
    .passthrough(),
]);

const responseToolSchema = z.union([
  z
    .object({
      type: z.literal("function"),
      name: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
      description: z.string().optional(),
      parameters: z.record(z.string(), z.unknown()).optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.enum(["web_search", "web_search_2025_08_26"]),
    })
    .passthrough(),
]);

const responseToolChoiceSchema = z.union([
  z.enum(["none", "auto", "required"]),
  z
    .object({
      type: z.literal("function"),
      name: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
    })
    .passthrough(),
  z
    .object({
      type: z.enum(["web_search", "web_search_2025_08_26"]),
    })
    .passthrough(),
]);

const responseTextFormatSchema = z
  .object({
    format: z
      .union([
        z.object({ type: z.literal("text") }).passthrough(),
        z.object({ type: z.literal("json_object") }).passthrough(),
        z
          .object({
            type: z.literal("json_schema"),
            name: z.string().min(1),
            schema: z.record(z.string(), z.unknown()),
          })
          .passthrough(),
      ]),
  })
  .passthrough();

export const emptyToolInputSchema = z.object({});

export const chatCompletionToolInputSchema = z
  .object({
    message: z.string().min(1).optional(),
    messages: z.array(chatMessageSchema).min(1).optional(),
    model: z.string().default("deepseek-v4-flash"),
    conversation_id: z.string().min(1).optional(),
    clear_conversation: z.boolean().default(false),
    frequency_penalty: z.number().min(-2).max(2).optional(),
    max_tokens: z.number().int().positive().optional(),
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
    reasoning_effort: z.enum(["low", "high", "max"]).optional(),
    user_id: z.string().min(1).max(512).regex(/^[a-zA-Z0-9_-]+$/).optional(),
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
  model: z.string().default("deepseek-v4-pro"),
  prompt: z.string().min(1),
  suffix: z.string().optional(),
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  stream: z.boolean().default(false),
  logprobs: z.number().int().min(0).max(20).optional(),
  echo: z.boolean().optional(),
  stop: stopSchema.optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  include_raw_response: z.boolean().default(false),
  extra_body: z.record(z.string(), z.unknown()).optional(),
});

export const responseToolInputSchema = z
  .object({
    model: z.string().optional(),
    input: z.union([z.string().min(1), z.array(responseInputItemSchema).min(1)]).optional(),
    instructions: z.string().min(1).optional(),
    reasoning: z
      .object({
        effort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]),
      })
      .strict()
      .optional(),
    max_output_tokens: z.number().int().positive().optional(),
    stream: z.boolean().default(false),
    temperature: z.number().min(0).max(2).optional(),
    top_p: z.number().min(0).max(1).optional(),
    text: responseTextFormatSchema.optional(),
    tools: z.array(responseToolSchema).optional(),
    tool_choice: responseToolChoiceSchema.optional(),
    top_logprobs: z.number().int().min(0).max(20).optional(),
    user: z.string().min(1).max(512).regex(/^[a-zA-Z0-9_-]+$/).optional(),
    include_raw_response: z.boolean().default(false),
    extra_body: z.record(z.string(), z.unknown()).optional(),
  })
  .superRefine((value, context) => {
    if (value.input === undefined && value.instructions === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one of `input` or `instructions` must be provided",
      });
    }
  });

export const resetConversationToolInputSchema = z.object({
  conversation_id: z.string().min(1),
});

export type ChatCompletionToolInput = z.infer<typeof chatCompletionToolInputSchema>;
export type CompletionToolInput = z.infer<typeof completionToolInputSchema>;
export type ResponseToolInput = z.infer<typeof responseToolInputSchema>;
export type ResetConversationToolInput = z.infer<typeof resetConversationToolInputSchema>;
