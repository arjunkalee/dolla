import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import type { AssistantRound, ToolUseCall } from "./loop";
import type { ModelMessage } from "./messages";
import { modelCallOptions, MAX_OUTPUT_TOKENS } from "./models";
import { usageFromAnthropic } from "./pricing";
import { cachedSystemPrompt, type CachedSystemBlock } from "./prompt";
import { cachedAssistantTools, type AssistantTool } from "./tools";

export type AssistantStreamArgs = {
  apiKey: string;
  model: string;
  messages: ModelMessage[];
  signal?: AbortSignal;
  onText: (delta: string) => void;
  onToolUse?: () => void;
  maxTokens?: number;
  system?: CachedSystemBlock[];
  tools?: AssistantTool[];
};

/** One model round trip. Text is forwarded until a tool call starts. Usage is billable. */
export async function streamAssistant(args: AssistantStreamArgs): Promise<AssistantRound> {
  const client = new Anthropic({ apiKey: args.apiKey });
  const stream = client.messages.stream(
    {
      model: args.model,
      max_tokens: args.maxTokens ?? MAX_OUTPUT_TOKENS,
      system: args.system ?? cachedSystemPrompt(),
      tools: args.tools ?? cachedAssistantTools(),
      messages: toSdkMessages(args.messages),
      ...modelCallOptions(args.model),
    },
    { signal: args.signal }
  );

  let announcedTool = false;
  const announceTool = () => {
    if (announcedTool) return;
    announcedTool = true;
    args.onToolUse?.();
  };
  stream.on("text", (delta) => {
    if (announcedTool || !delta) return;
    args.onText(delta);
  });
  stream.on("contentBlock", (block) => {
    if (block.type === "tool_use") announceTool();
  });

  const finalMessage = await stream.finalMessage();
  const toolUses = toolUsesFrom(finalMessage.content);
  if (toolUses.length > 0) announceTool();
  return {
    ...usageFromAnthropic(finalMessage.usage),
    stopReason: finalMessage.stop_reason,
    assistantContent: finalMessage.content,
    toolUses,
  };
}

function toSdkMessages(messages: ModelMessage[]): MessageParam[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content as MessageParam["content"],
  }));
}

function toolUsesFrom(content: readonly unknown[]): ToolUseCall[] {
  const uses: ToolUseCall[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const record = block as { type?: unknown; id?: unknown; name?: unknown; input?: unknown };
    if (record.type !== "tool_use") continue;
    if (typeof record.id !== "string" || typeof record.name !== "string") continue;
    uses.push({
      type: "tool_use",
      id: record.id,
      name: record.name,
      input: record.input ?? {},
    });
  }
  return uses;
}
