import { describe, expect, it } from "vitest";

import {
  chatCompletionToolInputSchema,
  completionToolInputSchema,
  fileIdToolInputSchema,
  listFilesToolInputSchema,
  responseToolInputSchema,
  uploadFileToolInputSchema,
} from "../src/deepseek/schemas.js";

describe("tool input schemas", () => {
  it("accepts current V4 chat parameters and pass-through extra_body", () => {
    const parsed = chatCompletionToolInputSchema.parse({
      message: "hello",
      model: "deepseek-v4-flash",
      stream: true,
      response_format: { type: "json_object" },
      thinking: { type: "enabled" },
      reasoning_effort: "low",
      user_id: "tenant_123",
      extra_body: {
        future_parameter: "supported",
      },
    });

    expect(parsed.model).toBe("deepseek-v4-flash");
    expect(parsed.thinking).toEqual({ type: "enabled" });
    expect(parsed.reasoning_effort).toBe("low");
    expect(parsed.user_id).toBe("tenant_123");
    expect(parsed.extra_body?.future_parameter).toBe("supported");
  });

  it("defaults chat requests to deepseek-flash and accepts every current reasoning effort", () => {
    const efforts = ["none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;

    for (const reasoning_effort of efforts) {
      const parsed = chatCompletionToolInputSchema.parse({
        message: "hello",
        reasoning_effort,
      });

      expect(parsed.model).toBe("deepseek-flash");
      expect(parsed.reasoning_effort).toBe(reasoning_effort);
    }
  });

  it("accepts current Chat image URL and file content variants", () => {
    const messages = [
      [
        { type: "text", text: "describe" },
        {
          type: "image_url",
          image_url: { url: "https://example.com/image.png", detail: "low" },
        },
      ],
      [{ type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo=" } }],
      [{ type: "file", file_id: "file-api-abc123" }],
      [
        {
          type: "file",
          file_data: "data:image/webp;base64,UklGRg==",
          filename: "image.webp",
        },
      ],
    ];

    for (const message of messages) {
      expect(chatCompletionToolInputSchema.safeParse({ message }).success).toBe(true);
    }
  });

  it("rejects malformed Chat image and file content across shortcut and history inputs", () => {
    const invalidContentParts = [
      { type: "image_url", image_url: {} },
      { type: "image_url", image_url: { url: "ftp://example.com/image.png" } },
      { type: "image_url", image_url: { url: "data:image/svg+xml;base64,PHN2Zz4=" } },
      { type: "file" },
      { type: "file", file_id: "file-api-a", file_data: "data:image/png;base64,aQ==" },
      { type: "file", file_id: "not-a-deepseek-file" },
      { type: "file", file_id: "file-api-a", filename: "not-allowed.png" },
    ];

    for (const contentPart of invalidContentParts) {
      expect(chatCompletionToolInputSchema.safeParse({ message: [contentPart] }).success).toBe(false);
    }

    expect(
      chatCompletionToolInputSchema.safeParse({
        messages: [{ role: "assistant", content: [{ type: "image_url", image_url: { url: "https://example.com/a.png" } }] }],
      }).success,
    ).toBe(false);
  });

  it("requires logprobs=true when top_logprobs is set", () => {
    const result = chatCompletionToolInputSchema.safeParse({
      message: "hello",
      top_logprobs: 5,
    });

    expect(result.success).toBe(false);
  });

  it("rejects malformed V4 thinking and tool definitions", () => {
    const badThinking = chatCompletionToolInputSchema.safeParse({
      message: "hello",
      thinking: { type: "auto" },
    });
    expect(badThinking.success).toBe(false);

    const badTool = chatCompletionToolInputSchema.safeParse({
      message: "hello",
      tools: [
        {
          type: "function",
          function: {},
        },
      ],
    });
    expect(badTool.success).toBe(false);
  });

  it("validates documented FIM completion endpoint fields", () => {
    const parsed = completionToolInputSchema.parse({
      prompt: "abc",
      model: "deepseek-v4-pro",
      suffix: "xyz",
      max_tokens: 32,
      stream: false,
      extra_body: {
        compatibility_flag: true,
      },
    });

    expect(parsed.model).toBe("deepseek-v4-pro");
    expect(parsed.prompt).toBe("abc");
    expect(parsed.suffix).toBe("xyz");
    expect(parsed.extra_body?.compatibility_flag).toBe(true);
  });

  it("rejects incomplete conditional Responses API structures", () => {
    const invalidInputs = [
      {
        input: "hello",
        tool_choice: { type: "function" },
      },
      {
        input: "hello",
        text: { format: { type: "json_schema" } },
      },
    ];

    for (const input of invalidInputs) {
      expect(responseToolInputSchema.safeParse(input).success).toBe(false);
    }
  });

  it("validates each structured Responses API input item variant", () => {
    const validItems = [
      { role: "user", content: "hello" },
      {
        role: "user",
        content: [
          { type: "input_text", text: "hello" },
          { type: "input_image", image_url: "https://example.com/a.png", detail: "original" },
        ],
      },
      {
        role: "developer",
        content: [{ type: "input_image", file_id: "file-api-image1" }],
      },
      {
        role: "assistant",
        content: [{ type: "output_text", text: "hello" }],
      },
      {
        type: "function_call",
        call_id: "call-1",
        name: "lookup",
        arguments: "{\"id\":1}",
      },
      {
        type: "function_call_output",
        call_id: "call-1",
        output: [
          { type: "input_text", text: "result" },
          { type: "input_image", file_id: "file-api-tool1" },
        ],
      },
      {
        type: "custom_tool_call",
        call_id: "custom-1",
        name: "apply_patch",
        input: "*** Begin Patch",
      },
      {
        type: "custom_tool_call_output",
        call_id: "custom-1",
        output: "Done!",
      },
      {
        type: "reasoning",
        content: [{ type: "reasoning_text", text: "reasoning" }],
      },
      { type: "web_search_call", id: "search-1" },
    ];

    for (const item of validItems) {
      expect(responseToolInputSchema.safeParse({ input: [item] }).success).toBe(true);
    }

    const invalidItems = [
      {},
      { type: "message", role: "user" },
      { type: "function_call", call_id: "call-1", name: "lookup" },
      { type: "function_call_output", call_id: "call-1" },
      { type: "reasoning" },
      { role: "user", content: [{}] },
      { role: "user", content: [{ type: "input_text" }] },
      { role: "system", content: [{ type: "input_image", file_id: "file-api-a" }] },
      { role: "assistant", content: [{ type: "input_image", file_id: "file-api-a" }] },
      { role: "user", content: [{ type: "input_image" }] },
      {
        role: "user",
        content: [{ type: "input_image", file_id: "file-api-a", image_url: "https://example.com/a.png" }],
      },
      { type: "custom_tool_call", call_id: "custom-1", name: "apply_patch" },
      { type: "custom_tool_call_output", call_id: "custom-1" },
      { type: "reasoning", content: [{ type: "input_text", text: "wrong variant" }] },
    ];

    for (const item of invalidItems) {
      expect(responseToolInputSchema.safeParse({ input: [item] }).success).toBe(false);
    }
  });

  it("validates Files API upload, listing, and identifier boundaries", () => {
    expect(
      uploadFileToolInputSchema.safeParse({
        filename: "pixel.png",
        file_data: "iVBORw0KGgo=",
        expires_after_seconds: 3600,
      }).success,
    ).toBe(true);
    expect(
      uploadFileToolInputSchema.safeParse({
        filename: "pixel.gif",
        file_data: "data:image/gif;base64,R0lGODlh",
        expires_after_seconds: 2592000,
      }).success,
    ).toBe(true);

    const invalidUploads = [
      { filename: "pixel.png", file_data: "not base64!" },
      { filename: "vector.svg", file_data: "data:image/svg+xml;base64,PHN2Zz4=" },
      { filename: "pixel.png", file_data: "iVBORw0KGgo=", expires_after_seconds: 3599 },
      { filename: "pixel.png", file_data: "iVBORw0KGgo=", expires_after_seconds: 2592001 },
    ];
    for (const input of invalidUploads) {
      expect(uploadFileToolInputSchema.safeParse(input).success).toBe(false);
    }

    expect(
      listFilesToolInputSchema.safeParse({
        after: "file-api-a",
        limit: 1000,
        order: "desc",
        purpose: "user_data",
      }).success,
    ).toBe(true);
    expect(listFilesToolInputSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(listFilesToolInputSchema.safeParse({ limit: 1001 }).success).toBe(false);
    expect(fileIdToolInputSchema.safeParse({ file_id: "file-api-abc_123" }).success).toBe(true);
    expect(fileIdToolInputSchema.safeParse({ file_id: "file-abc" }).success).toBe(false);
  });
});
