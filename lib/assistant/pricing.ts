/**
 * USD prices per million tokens, stored as micro-USD (1 USD = 1_000_000).
 * Anthropic list prices as of October 2026. Cache writes are the 5-minute
 * and 1-hour ephemeral tiers. `input` excludes tokens reported as cache
 * writes or cache reads — that is how the Messages API usage object works.
 */
export type ModelPrice = {
  inputPerMTokMicroUsd: number;
  outputPerMTokMicroUsd: number;
  cacheWrite5mPerMTokMicroUsd: number;
  cacheWrite1hPerMTokMicroUsd: number;
  cacheReadPerMTokMicroUsd: number;
};

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-sonnet-5-5": {
    inputPerMTokMicroUsd: 2_000_000,
    outputPerMTokMicroUsd: 10_000_000,
    cacheWrite5mPerMTokMicroUsd: 2_500_000,
    cacheWrite1hPerMTokMicroUsd: 4_000_000,
    cacheReadPerMTokMicroUsd: 100_000,
  },
  "claude-sonnet-5": {
    inputPerMTokMicroUsd: 2_000_000,
    outputPerMTokMicroUsd: 10_000_000,
    cacheWrite5mPerMTokMicroUsd: 2_500_000,
    cacheWrite1hPerMTokMicroUsd: 4_000_000,
    cacheReadPerMTokMicroUsd: 200_000,
  },
  "claude-sonnet-4-6": sonnet46Price(),
  "claude-sonnet-4-5": sonnet46Price(),
  "claude-sonnet-4-5-20250929": sonnet46Price(),
};

/** Used when DOLLA_AI_MODEL is not in the table, so a typo cannot undercount. */
export const FALLBACK_MODEL_PRICE: ModelPrice = sonnet46Price();

function sonnet46Price(): ModelPrice {
  return {
    inputPerMTokMicroUsd: 3_000_000,
    outputPerMTokMicroUsd: 15_000_000,
    cacheWrite5mPerMTokMicroUsd: 3_750_000,
    cacheWrite1hPerMTokMicroUsd: 6_000_000,
    cacheReadPerMTokMicroUsd: 300_000,
  };
}

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreation5mTokens: number;
  cacheCreation1hTokens: number;
  cacheReadTokens: number;
};

export function priceForModel(model: string): ModelPrice {
  return MODEL_PRICES[model] ?? FALLBACK_MODEL_PRICE;
}

export function emptyUsage(): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
    cacheReadTokens: 0,
  };
}

/** Integer micro-USD, rounded up so the cap never undercounts a partial micro. */
export function costMicroUsd(usage: TokenUsage, price: ModelPrice): number {
  const numerator =
    nonNeg(usage.inputTokens) * price.inputPerMTokMicroUsd +
    nonNeg(usage.outputTokens) * price.outputPerMTokMicroUsd +
    nonNeg(usage.cacheCreation5mTokens) * price.cacheWrite5mPerMTokMicroUsd +
    nonNeg(usage.cacheCreation1hTokens) * price.cacheWrite1hPerMTokMicroUsd +
    nonNeg(usage.cacheReadTokens) * price.cacheReadPerMTokMicroUsd;
  return Math.ceil(numerator / 1_000_000);
}

export function usageFromAnthropic(usage: {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation?: {
    ephemeral_5m_input_tokens?: number | null;
    ephemeral_1h_input_tokens?: number | null;
  } | null;
}): TokenUsage {
  const five = usage.cache_creation?.ephemeral_5m_input_tokens;
  const hour = usage.cache_creation?.ephemeral_1h_input_tokens;
  if (typeof five === "number" || typeof hour === "number") {
    return {
      inputTokens: nonNeg(usage.input_tokens),
      outputTokens: nonNeg(usage.output_tokens),
      cacheCreation5mTokens: nonNeg(five),
      cacheCreation1hTokens: nonNeg(hour),
      cacheReadTokens: nonNeg(usage.cache_read_input_tokens),
    };
  }
  return {
    inputTokens: nonNeg(usage.input_tokens),
    outputTokens: nonNeg(usage.output_tokens),
    cacheCreation5mTokens: nonNeg(usage.cache_creation_input_tokens),
    cacheCreation1hTokens: 0,
    cacheReadTokens: nonNeg(usage.cache_read_input_tokens),
  };
}

export function microUsdToNumber(micro: number): number {
  return nonNeg(micro) / 1_000_000;
}

function nonNeg(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}
