import { z } from "zod";

import {
  MAX_DEEPSEEK_FILE_BASE64_CHARS,
  inspectCanonicalBase64,
  isBase64SizeWithinLimit,
} from "./image-data.js";

const FILE_ID_PATTERN = /^file-api-[a-zA-Z0-9_-]+$/;
const SUPPORTED_IMAGE_DATA_URL_PATTERN =
  /^data:image\/(jpeg|png|gif|webp);base64,([a-zA-Z0-9+/]+={0,2})$/;

const fileIdSchema = z.string().regex(FILE_ID_PATTERN, "Expected a DeepSeek file ID starting with `file-api-`");

const imageDataUrlSchema = z
  .string()
  .refine((value) => SUPPORTED_IMAGE_DATA_URL_PATTERN.test(value) && hasValidBase64Payload(value), {
    message: "Expected a JPEG, PNG, GIF, or WebP base64 data URL",
  });

const imageReferenceSchema = z.string().refine(isSupportedImageReference, {
  message: "Expected an HTTP(S) image URL or supported image data URL",
});

const chatTextContentPartSchema = z
  .object({
    type: z.literal("text"),
    text: z.string().min(1),
  })
  .passthrough();

const chatImageContentPartSchema = z
  .object({
    type: z.literal("image_url"),
    image_url: z
      .object({
        url: imageReferenceSchema,
        detail: z.enum(["low", "high", "original", "auto"]).optional(),
      })
      .strict(),
  })
  .passthrough();

const chatFileContentPartSchema = z
  .object({
    type: z.literal("file"),
    file_id: fileIdSchema.optional(),
    file_data: imageDataUrlSchema.optional(),
    filename: z.string().min(1).max(512).optional(),
  })
  .passthrough()
  .superRefine((value, context) => {
    if ((value.file_id === undefined) === (value.file_data === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A file content part requires exactly one of `file_id` or `file_data`",
      });
    }

    if (value.filename !== undefined && value.file_data === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["filename"],
        message: "`filename` is valid only with `file_data`",
      });
    }
  });

const chatContentPartSchema = z.union([
  chatTextContentPartSchema,
  chatImageContentPartSchema,
  chatFileContentPartSchema,
]);

export const chatMessageSchema = z
  .object({
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: z.union([z.string(), z.array(chatContentPartSchema).min(1), z.null()]).optional(),
    name: z.string().optional(),
    tool_call_id: z.string().optional(),
    prefix: z.boolean().optional(),
    reasoning_content: z.string().optional(),
    tool_calls: z.array(z.record(z.string(), z.unknown())).optional(),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (Array.isArray(value.content) && !["user", "tool"].includes(value.role)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content"],
        message: "Multimodal content is supported only in user and tool messages",
      });
    }
  });

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

const responseTextContentPartSchema = z.union([
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

const responseImageContentPartSchema = z
  .object({
    type: z.literal("input_image"),
    image_url: imageReferenceSchema.optional(),
    file_id: fileIdSchema.optional(),
    detail: z.enum(["low", "high", "original", "auto"]).optional(),
  })
  .passthrough()
  .superRefine((value, context) => {
    if ((value.image_url === undefined) === (value.file_id === undefined)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "An input image requires exactly one of `image_url` or `file_id`",
      });
    }
  });

const responseMessageContentPartSchema = z.union([
  responseTextContentPartSchema,
  responseImageContentPartSchema,
]);

const responseToolOutputContentPartSchema = z.union([
  z
    .object({
      type: z.literal("input_text"),
      text: z.string().min(1),
    })
    .passthrough(),
  responseImageContentPartSchema,
]);

const responseReasoningContentPartSchema = z
  .object({
    type: z.literal("reasoning_text"),
    text: z.string().min(1),
  })
  .passthrough();

const responseMessageInputItemSchema = z
  .object({
    type: z.literal("message").optional(),
    role: z.enum(["user", "assistant", "system", "developer"]),
    content: z.union([z.string(), z.array(responseMessageContentPartSchema).min(1)]),
  })
  .passthrough()
  .superRefine((value, context) => {
    if (
      Array.isArray(value.content) &&
      ["system", "assistant"].includes(value.role) &&
      value.content.some((part) => part.type === "input_image")
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["content"],
        message: "Responses images are not supported in system or assistant messages",
      });
    }
  });

const responseInputItemSchema = z.union([
  responseMessageInputItemSchema,
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
      output: z.union([z.string(), z.array(responseToolOutputContentPartSchema).min(1)]),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("custom_tool_call"),
      call_id: z.string().min(1),
      name: z.string().min(1),
      input: z.string(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("custom_tool_call_output"),
      call_id: z.string().min(1),
      output: z.union([z.string(), z.array(responseToolOutputContentPartSchema).min(1)]),
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
    message: z.union([z.string().min(1), z.array(chatContentPartSchema).min(1)]).optional(),
    messages: z.array(chatMessageSchema).min(1).optional(),
    model: z.string().default("deepseek-flash"),
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
    reasoning_effort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
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
  model: z.string().default("deepseek-flash"),
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

export const uploadFileToolInputSchema = z.object({
  filename: z.string().min(1).max(512),
  file_data: z.string().refine(hasValidUploadBase64, {
    message:
      "Expected raw base64 or a JPEG, PNG, GIF, or WebP base64 data URL no larger than 64 MiB",
  }),
  expires_after_seconds: z.number().int().min(3600).max(2592000).optional(),
});

export const listFilesToolInputSchema = z.object({
  after: fileIdSchema.optional(),
  limit: z.number().int().min(1).max(1000).optional(),
  order: z.enum(["asc", "desc"]).optional(),
  purpose: z.literal("user_data").optional(),
});

export const fileIdToolInputSchema = z.object({
  file_id: fileIdSchema,
});

export type ChatCompletionToolInput = z.infer<typeof chatCompletionToolInputSchema>;
export type CompletionToolInput = z.infer<typeof completionToolInputSchema>;
export type ResponseToolInput = z.infer<typeof responseToolInputSchema>;
export type ResetConversationToolInput = z.infer<typeof resetConversationToolInputSchema>;
export type UploadFileToolInput = z.infer<typeof uploadFileToolInputSchema>;
export type ListFilesToolInput = z.infer<typeof listFilesToolInputSchema>;
export type FileIdToolInput = z.infer<typeof fileIdToolInputSchema>;

function isSupportedImageReference(value: string): boolean {
  if (SUPPORTED_IMAGE_DATA_URL_PATTERN.test(value)) {
    return hasValidBase64Payload(value);
  }

  if (value.length > 8192) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function hasValidUploadBase64(value: string): boolean {
  if (value.startsWith("data:")) {
    return SUPPORTED_IMAGE_DATA_URL_PATTERN.test(value) && hasValidBase64Payload(value);
  }

  return hasValidBase64Payload(value);
}

function hasValidBase64Payload(value: string): boolean {
  const commaIndex = value.indexOf(",");
  const payload = commaIndex >= 0 ? value.slice(commaIndex + 1) : value;

  if (payload.length === 0 || payload.length > MAX_DEEPSEEK_FILE_BASE64_CHARS) {
    return false;
  }

  const inspection = inspectCanonicalBase64(payload);
  return (
    inspection !== undefined &&
    isBase64SizeWithinLimit(payload.length, inspection.padding)
  );
}
