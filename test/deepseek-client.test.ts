import { describe, expect, it, vi } from "vitest";

import { DeepSeekApiClient, DeepSeekApiError } from "../src/deepseek/client.js";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
    },
  });
}

function sseResponse(events: Array<Record<string, unknown> | "[DONE]">, status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        const chunk = event === "[DONE]" ? "data: [DONE]\n\n" : `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(chunk));
      }

      controller.close();
    },
  });

  return new Response(stream, {
    status,
    headers: {
      "content-type": "text/event-stream",
    },
  });
}

describe("DeepSeekApiClient", () => {
  it("sends non-stream chat completion payload to /chat/completions", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: "chat-1",
        object: "chat.completion",
        created: 1,
        model: "deepseek-v4-flash",
        choices: [
          {
            index: 0,
            finish_reason: "stop",
            message: {
              role: "assistant",
              content: "hello",
            },
          },
        ],
      }),
    );

    const client = new DeepSeekApiClient({
      apiKey: "test-key",
      fetchFn: fetchMock,
    });

    const result = await client.createChatCompletion({
      model: "deepseek-v4-flash",
      messages: [{ role: "user", content: "hello" }],
      thinking: { type: "disabled" },
      reasoning_effort: "high",
      max_tokens: 1024,
    });

    expect(result.response.choices[0]?.message.content).toBe("hello");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(init.method).toBe("POST");

    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("deepseek-v4-flash");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.reasoning_effort).toBe("high");
    expect(body.max_tokens).toBe(1024);
    expect(body.max_completion_tokens).toBeUndefined();
  });

  it("aggregates streaming chat responses with reasoning and tool calls", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      sseResponse([
        {
          id: "chat-stream-1",
          object: "chat.completion.chunk",
          created: 10,
          model: "deepseek-v4-flash",
          choices: [
            {
              index: 0,
              delta: {
                role: "assistant",
                content: "Hello",
                reasoning_content: "First thought. ",
                tool_calls: [
                  {
                    index: 0,
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "weather",
                      arguments: "{\"city\":\"N",
                    },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: "chat-stream-1",
          object: "chat.completion.chunk",
          created: 11,
          model: "deepseek-v4-flash",
          choices: [
            {
              index: 0,
              delta: {
                content: " world",
                reasoning_content: "Second thought.",
                tool_calls: [
                  {
                    index: 0,
                    type: "function",
                    function: {
                      arguments: "YC\"}",
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 7,
            total_tokens: 19,
          },
        },
        "[DONE]",
      ]),
    );

    const client = new DeepSeekApiClient({
      apiKey: "test-key",
      fetchFn: fetchMock,
    });

    const result = await client.createChatCompletion({
      model: "deepseek-v4-flash",
      stream: true,
      messages: [{ role: "user", content: "hi" }],
      thinking: { type: "enabled" },
    });

    expect(result.streamChunkCount).toBe(2);
    expect(result.response.model).toBe("deepseek-v4-flash");
    expect(result.response.choices[0]?.message.content).toBe("Hello world");
    expect(result.response.choices[0]?.message.reasoning_content).toBe("First thought. Second thought.");
    expect(result.response.choices[0]?.message.tool_calls?.[0]?.function.name).toBe("weather");
    expect(result.response.choices[0]?.message.tool_calls?.[0]?.function.arguments).toBe('{"city":"NYC"}');
    expect(result.response.choices[0]?.finish_reason).toBe("tool_calls");
  });

  it("does not retry or swap models when DeepSeek returns an API error", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(
        {
          error: {
            message: "temporarily unavailable",
          },
        },
        503,
      ),
    );

    const client = new DeepSeekApiClient({
      apiKey: "test-key",
      fetchFn: fetchMock,
    });

    await expect(
      client.createChatCompletion({
        model: "deepseek-v4-pro",
        messages: [{ role: "user", content: "test" }],
      }),
    ).rejects.toBeInstanceOf(DeepSeekApiError);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.model).toBe("deepseek-v4-pro");
  });

  it("sends non-stream FIM completion payload directly to /beta/completions", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        id: "cmpl-1",
        object: "text_completion",
        created: 20,
        model: "deepseek-v4-pro",
        choices: [{ index: 0, text: "ok", finish_reason: "stop" }],
      }),
    );

    const client = new DeepSeekApiClient({
      apiKey: "test-key",
      fetchFn: fetchMock,
      baseUrl: "https://api.deepseek.com",
    });

    const result = await client.createCompletion({
      model: "deepseek-v4-pro",
      prompt: "def add(a, b):",
      suffix: "return result",
      max_tokens: 16,
    });

    expect(result.response.choices[0]?.text).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/beta/completions");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("deepseek-v4-pro");
    expect(body.suffix).toBe("return result");
    expect(body.best_of).toBeUndefined();
  });

  it("supports streaming FIM completion aggregation", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      sseResponse([
        {
          id: "cmpl-stream-1",
          object: "text_completion.chunk",
          created: 10,
          model: "deepseek-v4-pro",
          choices: [{ index: 0, text: "foo", finish_reason: null }],
        },
        {
          id: "cmpl-stream-1",
          object: "text_completion.chunk",
          created: 11,
          model: "deepseek-v4-pro",
          choices: [{ index: 0, text: "bar", finish_reason: "stop" }],
          usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
        },
        "[DONE]",
      ]),
    );

    const client = new DeepSeekApiClient({
      apiKey: "test-key",
      fetchFn: fetchMock,
    });

    const result = await client.createCompletion({
      model: "deepseek-v4-pro",
      prompt: "abc",
      stream: true,
    });

    expect(result.streamChunkCount).toBe(2);
    expect(result.response.choices[0]?.text).toBe("foobar");
    expect(result.response.choices[0]?.finish_reason).toBe("stop");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.deepseek.com/beta/completions");
  });

  it("calls /models and /user/balance endpoints", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({
          object: "list",
          data: [
            { id: "deepseek-v4-flash", object: "model" },
            { id: "deepseek-v4-pro", object: "model" },
          ],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          is_available: true,
          balance_infos: [
            {
              currency: "USD",
              total_balance: "10.50",
              granted_balance: "0.00",
              topped_up_balance: "10.50",
            },
          ],
        }),
      );

    const client = new DeepSeekApiClient({
      apiKey: "test-key",
      fetchFn: fetchMock,
    });

    const models = await client.listModels();
    const balance = await client.getUserBalance();

    expect(models.data.map((model) => model.id)).toEqual(["deepseek-v4-flash", "deepseek-v4-pro"]);
    expect(balance.is_available).toBe(true);
    expect(balance.balance_infos[0]?.currency).toBe("USD");

    const firstUrl = fetchMock.mock.calls[0]?.[0] as string;
    const secondUrl = fetchMock.mock.calls[1]?.[0] as string;
    expect(firstUrl).toBe("https://api.deepseek.com/models");
    expect(secondUrl).toBe("https://api.deepseek.com/user/balance");
  });
});
