import Anthropic from "@anthropic-ai/sdk";
import { modelCallOptions, MAX_OUTPUT_TOKENS } from "./models";
import type { AssistantTurn } from "./messages";
import { cachedSystemPrompt } from "./prompt";
import { usageFromAnthropic, type TokenUsage } from "./pricing";

export type AssistantStreamArgs = {
  apiKey: string;
  model: string;
  messages: AssistantTurn[];
  signal?: AbortSignal;
  onText: (delta: string) => void;
};

/** Streams text deltas and returns the billable usage. Never logs the API key. */
export async function streamAssistant(args: AssistantStreamArgs): Promise<TokenUsage> {
  const client = new Anthropic({ apiKey: args.apiKey });
  const stream = client.messages.stream(
    {
      model: args.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: cachedSystemPrompt(),
      messages: args.messages,
      ...modelCallOptions(args.model),
    },
    { signal: args.signal }
  );
  stream.on("text", (delta) => {
    args.onText(delta);
  });
  const finalMessage = await stream.finalMessage();
  return usageFromAnthropic(finalMessage.usage);
}
