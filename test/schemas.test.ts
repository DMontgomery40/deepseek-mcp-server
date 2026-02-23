import { describe, expect, it } from "vitest";

import { chatCompletionToolInputSchema, completionToolInputSchema } from "../src/deepseek/schemas.js";

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
});
