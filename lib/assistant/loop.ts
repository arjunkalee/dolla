import type { ModelMessage } from "./messages";
import type { TokenUsage } from "./pricing";
import type { ToolOutcome } from "./tools";

export const MAX_TOOL_ROUNDS = 6;

export const TOOL_LOOP_LIMIT_MESSAGE =
  "I had to stop looking that up. Ask a narrower question.";

export type ToolUseCall = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
};

export type AssistantRound = TokenUsage & {
  stopReason?: string | null;
  /** Full assistant content to send back, including thinking blocks when the API returns them. */
  assistantContent?: unknown;
  toolUses?: ToolUseCall[];
};

export type LoopEvent =
  | { type: "text"; text: string }
  | { type: "reset" }
  | { type: "looking_up" };

export type ToolLoopResult = {
  stop: "done" | "cap" | "limit";
};

type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: true;
};

/**
 * Calls the model until it stops requesting tools.
 * Each round trip is the caller's job to bill; this checks the cap before every one.
 * At most `maxRounds` model calls (default 6). A failed tool becomes a tool_result
 * with is_error instead of throwing away the turn.
 */
export async function runToolLoop(input: {
  messages: ModelMessage[];
  maxRounds?: number;
  capMicroUsd: number;
  capReached: (spentMicroUsd: number, capMicroUsd: number) => boolean;
  capMessage: (spentMicroUsd: number) => string;
  readSpend: () => Promise<number>;
  recordUsage: (usage: TokenUsage) => Promise<void>;
  streamRound: (
    messages: ModelMessage[],
    hooks: { onText: (delta: string) => void; onToolUse: () => void }
  ) => Promise<AssistantRound>;
  executeTool: (name: string, toolInput: unknown) => ToolOutcome;
  emit: (event: LoopEvent) => void;
}): Promise<ToolLoopResult> {
  const maxRounds = input.maxRounds ?? MAX_TOOL_ROUNDS;
  const messages = input.messages;
  let visible = "";

  for (let round = 1; round <= maxRounds; round++) {
    const spent = await input.readSpend();
    if (input.capReached(spent, input.capMicroUsd)) {
      const message = input.capMessage(spent);
      const extra = visible.trim() ? `\n\n${message}` : message;
      visible += extra;
      input.emit({ type: "text", text: extra });
      return { stop: "cap" };
    }

    let announced = false;
    const result = await input.streamRound(messages, {
      onText: (delta) => {
        if (announced || !delta) return;
        visible += delta;
        input.emit({ type: "text", text: delta });
      },
      onToolUse: () => {
        if (announced) return;
        announced = true;
        visible = "";
        input.emit({ type: "reset" });
        input.emit({ type: "looking_up" });
      },
    });

    await input.recordUsage(result);

    const toolUses = result.toolUses ?? [];
    if (toolUses.length === 0) return { stop: "done" };
    if (!announced) {
      announced = true;
      visible = "";
      input.emit({ type: "reset" });
      input.emit({ type: "looking_up" });
    }
    if (round === maxRounds) {
      if (!visible.trim()) {
        visible = TOOL_LOOP_LIMIT_MESSAGE;
        input.emit({ type: "text", text: TOOL_LOOP_LIMIT_MESSAGE });
      }
      return { stop: "limit" };
    }

    const assistantContent = Array.isArray(result.assistantContent)
      ? result.assistantContent
      : toolUses;
    messages.push({ role: "assistant", content: assistantContent });
    messages.push({
      role: "user",
      content: toolUses.map((tool) => toolResultFor(tool, input.executeTool)),
    });
  }

  return { stop: "limit" };
}

function toolResultFor(
  tool: ToolUseCall,
  executeTool: (name: string, toolInput: unknown) => ToolOutcome
): ToolResultBlock {
  try {
    const outcome = executeTool(tool.name, tool.input);
    if (!outcome.ok) {
      return {
        type: "tool_result",
        tool_use_id: tool.id,
        is_error: true,
        content: shortError(outcome.error),
      };
    }
    return {
      type: "tool_result",
      tool_use_id: tool.id,
      content: JSON.stringify(outcome.data),
    };
  } catch {
    return {
      type: "tool_result",
      tool_use_id: tool.id,
      is_error: true,
      content: "That lookup failed.",
    };
  }
}

function shortError(message: string): string {
  const text = message.replace(/\s+/g, " ").trim();
  if (!text) return "That lookup failed.";
  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}
