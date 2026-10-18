import type { ChatCitation } from "@/lib/types";
import type { ModelMessage } from "./messages";
import type { TokenUsage } from "./pricing";
import type { ToolOutcome } from "./tools";
import { sanitizeCitations, searchFailureNote } from "./web-search";

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
  citations?: ChatCitation[];
  /** True when this round's web searches all failed and left nothing to cite. */
  searchFailed?: boolean;
};

export type LoopEvent =
  | { type: "text"; text: string }
  | { type: "reset" }
  | { type: "looking_up" }
  | { type: "citations"; citations: ChatCitation[] };

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
  const citations: ChatCitation[] = [];
  let searchFailed = false;

  const absorb = (result: AssistantRound) => {
    const found = sanitizeCitations(result.citations);
    if (found.length > 0) {
      for (const citation of found) {
        if (!citations.some((item) => item.url === citation.url)) citations.push(citation);
      }
      searchFailed = false;
    } else if (result.searchFailed) {
      searchFailed = true;
    }
  };

  const finish = (stop: ToolLoopResult["stop"], withSearchNote: boolean): ToolLoopResult => {
    if (withSearchNote && searchFailed) {
      const note = searchFailureNote(visible);
      if (note) {
        visible += note;
        input.emit({ type: "text", text: note });
      }
    }
    if (citations.length > 0) input.emit({ type: "citations", citations: [...citations] });
    return { stop };
  };

  for (let round = 1; round <= maxRounds; round++) {
    const spent = await input.readSpend();
    if (input.capReached(spent, input.capMicroUsd)) {
      const message = input.capMessage(spent);
      const extra = visible.trim() ? `\n\n${message}` : message;
      visible += extra;
      input.emit({ type: "text", text: extra });
      return finish("cap", false);
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
    absorb(result);

    const toolUses = result.toolUses ?? [];
    if (toolUses.length === 0) {
      // A paused server-side search continues by sending the assistant blocks back unchanged.
      if (
        result.stopReason === "pause_turn" &&
        round < maxRounds &&
        Array.isArray(result.assistantContent)
      ) {
        messages.push({ role: "assistant", content: result.assistantContent });
        continue;
      }
      return finish("done", true);
    }
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
      return finish("limit", true);
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

  return finish("limit", true);
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
