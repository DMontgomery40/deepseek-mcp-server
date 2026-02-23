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

    return messages.slice(messages.length - this.maxMessagesPerConversation);
  }
}
