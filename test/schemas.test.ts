import { describe, expect, it } from "vitest";

import {
  chatCompletionToolInputSchema,
  completionToolInputSchema,
  imageGenerationToolInputSchema,
  videoGenerationToolInputSchema,
  videoUploadToolInputSchema,
  visionUploadToolInputSchema,
} from "../src/deepseek/schemas.js";

describe("tool input schemas", () => {
  it("accepts current chat parameters and pass-through extra_body", () => {
    const parsed = chatCompletionToolInputSchema.parse({
      message: "hello",
      model: "deepseek-reasoner",
      max_completion_tokens: 4096,
      stream: true,
      response_format: { type: "json_object" },
      thinking: { type: "enabled" },
      extra_body: {
        future_parameter: "supported",
      },
    });

    expect(parsed.model).toBe("deepseek-reasoner");
    expect(parsed.extra_body?.future_parameter).toBe("supported");
  });

  it("requires logprobs=true when top_logprobs is set", () => {
    const result = chatCompletionToolInputSchema.safeParse({
      message: "hello",
      top_logprobs: 5,
    });

    expect(result.success).toBe(false);
  });

  it("rejects malformed tool definitions", () => {
    const result = chatCompletionToolInputSchema.safeParse({
      message: "hello",
      tools: [
        {
          type: "function",
          function: {},
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("validates completion endpoint fields", () => {
    const parsed = completionToolInputSchema.parse({
      prompt: "abc",
      max_tokens: 32,
      stream: false,
      best_of: 2,
      extra_body: {
        compatibility_flag: true,
      },
    });

    expect(parsed.prompt).toBe("abc");
    expect(parsed.best_of).toBe(2);
    expect(parsed.extra_body?.compatibility_flag).toBe(true);
  });

  it("requires either file_url or file_base64 for upload tools", () => {
    expect(() => visionUploadToolInputSchema.parse({})).toThrow();
    expect(() => videoUploadToolInputSchema.parse({})).toThrow();

    const visionParsed = visionUploadToolInputSchema.parse({
      file_url: "https://example.com/image.jpg",
    });
    expect(visionParsed.file_url).toBe("https://example.com/image.jpg");

    const videoParsed = videoUploadToolInputSchema.parse({
      file_base64: "ZmFrZV92aWRlb19kYXRh",
      mime_type: "video/mp4",
    });
    expect(videoParsed.file_base64).toBe("ZmFrZV92aWRlb19kYXRh");
  });

  it("validates image_generation and video_generation inputs", () => {
    const imageParsed = imageGenerationToolInputSchema.parse({
      prompt: "A scenic mountain lake",
      n: 1,
      response_format: "url",
    });
    expect(imageParsed.prompt).toBe("A scenic mountain lake");

    const videoParsed = videoGenerationToolInputSchema.parse({
      prompt: "A short cinematic pan over mountains",
    });
    expect(videoParsed.wait_for_completion).toBe(false);
    expect(videoParsed.poll_interval_ms).toBe(3000);
    expect(videoParsed.max_wait_ms).toBe(60000);
    expect(videoParsed.max_stall_polls).toBe(12);
  });
});
