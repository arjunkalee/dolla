import type { ChatMessage } from "@/lib/types";
import { HISTORY_LIMIT } from "./models";

export type AssistantTurn = {
  role: "user" | "assistant";
  content: string;
};

export function trimHistory(messages: ChatMessage[], limit = HISTORY_LIMIT): AssistantTurn[] {
  const mapped: AssistantTurn[] = [];
  for (const message of messages.slice(-limit)) {
    const content = message.text.trim();
    if (!content) continue;
    const role: AssistantTurn["role"] = message.role === "user" ? "user" : "assistant";
    const previous = mapped[mapped.length - 1];
    if (previous && previous.role === role) {
      previous.content = `${previous.content}\n\n${content}`;
    } else {
      mapped.push({ role, content });
    }
  }
  while (mapped[0]?.role === "assistant") mapped.shift();
  return mapped;
}

/** Snapshot stays on the newest user turn so the cached system prompt does not change. */
export function buildModelMessages(
  history: ChatMessage[],
  snapshot: string,
  userText: string
): AssistantTurn[] {
  const prior = trimHistory(history);
  const content = `Context (current Dolla numbers, not a request to edit):\n${snapshot}\n\nQuestion:\n${userText.trim()}`;
  const last = prior[prior.length - 1];
  if (last?.role === "user") {
    return [
      ...prior.slice(0, -1),
      { role: "user", content: `${last.content}\n\n${content}` },
    ];
  }
  return [...prior, { role: "user", content }];
}
