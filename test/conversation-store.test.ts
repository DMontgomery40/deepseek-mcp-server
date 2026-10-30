import { describe, expect, it } from "vitest";

import { ConversationStore } from "../src/conversation-store.js";
import { DeepSeekChatMessage } from "../src/deepseek/types.js";

const system = (content: string): DeepSeekChatMessage => ({
  role: "system",
  content,
});
const user = (content: string): DeepSeekChatMessage => ({
  role: "user",
  content,
});
const assistant = (content: string): DeepSeekChatMessage => ({
  role: "assistant",
  content,
});
const call = (id: string) => ({
  id,
  type: "function" as const,
  function: { name: "lookup", arguments: "{}" },
});
const toolResult = (id: string): DeepSeekChatMessage => ({
  role: "tool",
  tool_call_id: id,
  content: `result-${id}`,
});

describe("ConversationStore capping", () => {
  it("stores histories under the cap unchanged", () => {
    const store = new ConversationStore(4);
    const messages = [system("s"), user("u1"), assistant("a1")];
    store.set("c", messages);
    expect(store.get("c")).toEqual(messages);
  });

  it("pins leading system messages while trimming the oldest turns", () => {
    const store = new ConversationStore(4);
    store.set("c", [
      system("s"),
      user("u1"),
      assistant("a1"),
      user("u2"),
      assistant("a2"),
    ]);
    expect(store.get("c")).toEqual([
      system("s"),
      assistant("a1"),
      user("u2"),
      assistant("a2"),
    ]);
  });

  it("never starts the trimmed remainder with an orphaned tool result", () => {
    const store = new ConversationStore(3);
    store.append("c", [
      user("u1"),
      {
        role: "assistant",
        content: "",
        tool_calls: [call("t1"), call("t2")],
      },
      toolResult("t1"),
      toolResult("t2"),
      assistant("a1"),
    ]);
    expect(store.get("c")).toEqual([assistant("a1")]);
  });

  it("keeps every capped history within the limit and well ordered", () => {
    const history: DeepSeekChatMessage[] = [
      system("s1"),
      system("s2"),
      user("u1"),
      { role: "assistant", content: "", tool_calls: [call("t1")] },
      toolResult("t1"),
      assistant("a1"),
      user("u2"),
      {
        role: "assistant",
        content: "",
        tool_calls: [call("t2"), call("t3")],
      },
      toolResult("t2"),
      toolResult("t3"),
      assistant("a2"),
    ];

    for (let max = 1; max <= history.length + 1; max += 1) {
      const store = new ConversationStore(max);
      store.set("c", history);
      const capped = store.get("c");

      expect(capped.length).toBeLessThanOrEqual(max);
      const firstNonSystem = capped.findIndex((m) => m.role !== "system");
      if (firstNonSystem >= 0) {
        expect(capped[firstNonSystem]?.role).not.toBe("tool");
      }
      if (max >= 2) {
        expect(capped.slice(0, 2)).toEqual([system("s1"), system("s2")]);
      }
    }
  });
});
