import { describe, expect, it } from "vitest";

import {
  chatCompletionToolInputSchema,
  completionToolInputSchema,
  responseToolInputSchema,
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
        content: [{ type: "input_text", text: "hello" }],
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
        output: "result",
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
      { type: "reasoning", content: [{ type: "input_text", text: "wrong variant" }] },
    ];

    for (const item of invalidItems) {
      expect(responseToolInputSchema.safeParse({ input: [item] }).success).toBe(false);
    }
  });
});
