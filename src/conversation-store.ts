import { DeepSeekChatMessage } from "./deepseek/types.js";

export class ConversationStore {
  private readonly store = new Map<string, DeepSeekChatMessage[]>();
  private readonly maxMessagesPerConversation: number;

  constructor(maxMessagesPerConversation = 200) {
    this.maxMessagesPerConversation = maxMessagesPerConversation;
  }

  get(conversationId: string): DeepSeekChatMessage[] {
    return [...(this.store.get(conversationId) ?? [])];
  }

  set(conversationId: string, messages: DeepSeekChatMessage[]): void {
    const normalized = this.cap(messages);
    this.store.set(conversationId, normalized);
  }

  append(conversationId: string, messages: DeepSeekChatMessage[]): void {
    const current = this.store.get(conversationId) ?? [];
    this.store.set(conversationId, this.cap([...current, ...messages]));
  }

  clear(conversationId: string): boolean {
    return this.store.delete(conversationId);
  }

  listConversationIds(): string[] {
    return [...this.store.keys()].sort();
  }

  private cap(messages: DeepSeekChatMessage[]): DeepSeekChatMessage[] {
    if (messages.length <= this.maxMessagesPerConversation) {
      return messages;
    }

    // Keep the leading system prompt(s) pinned so trimming old turns does not
    // silently change the conversation's instructions.
    let pinnedCount = 0;
    while (
      pinnedCount < messages.length &&
      messages[pinnedCount]?.role === "system"
    ) {
      pinnedCount += 1;
    }
    const pinned = messages
      .slice(0, pinnedCount)
      .slice(-this.maxMessagesPerConversation);
    const budget = this.maxMessagesPerConversation - pinned.length;
    const rest = budget > 0 ? messages.slice(pinnedCount).slice(-budget) : [];

    // A tool result must follow the assistant message carrying its tool_calls;
    // drop tool results orphaned by the cut so the history stays valid.
    let start = 0;
    while (start < rest.length && rest[start]?.role === "tool") {
      start += 1;
    }

    return [...pinned, ...rest.slice(start)];
  }
}
