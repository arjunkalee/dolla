export const DEFAULT_ASSISTANT_MODEL = "claude-sonnet-5-5";

export const MAX_OUTPUT_TOKENS = 1024;

export const HISTORY_LIMIT = 20;

export function resolveAssistantModel(env: Record<string, string | undefined> = process.env): string {
  const override = env.DOLLA_AI_MODEL?.trim();
  return override || DEFAULT_ASSISTANT_MODEL;
}

/**
 * Sonnet 5.5 thinks before it answers unless told not to, and those tokens
 * count against max_tokens and the monthly cap. `between_tools` skips that
 * up-front pass. Thinking can still run between tool calls, and effort stays low.
 */
export function modelCallOptions(model: string): {
  thinking?: { type: "between_tools" };
  output_config?: { effort: "low" };
} {
  if (model === DEFAULT_ASSISTANT_MODEL) {
    return {
      thinking: { type: "between_tools" },
      output_config: { effort: "low" },
    };
  }
  return {};
}
