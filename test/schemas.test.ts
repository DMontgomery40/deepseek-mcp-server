import { describe, expect, it } from "vitest";

import {
  chatCompletionToolInputSchema,
  completionToolInputSchema,
} from "../src/deepseek/schemas.js";

describe("tool input schemas", () => {
  it("accepts current V4 chat parameters and pass-through extra_body", () => {
    const parsed = chatCompletionToolInputSchema.parse({
      message: "hello",
      model: "deepseek-v4-flash",
      stream: true,
      response_format: { type: "json_object" },
      thinking: { type: "enabled" },
      reasoning_effort: "max",
      extra_body: {
        future_parameter: "supported",
      },
    });

    expect(parsed.model).toBe("deepseek-v4-flash");
    expect(parsed.thinking).toEqual({ type: "enabled" });
    expect(parsed.reasoning_effort).toBe("max");
    expect(parsed.extra_body?.future_parameter).toBe("supported");
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
});
