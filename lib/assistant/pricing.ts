/**
 * USD prices per million tokens, stored as micro-USD (1 USD = 1_000_000).
 * Anthropic list prices as of October 2026. A 5-minute cache write is
 * 1.25× base input and a 1-hour cache write is 2× base input. Assistant
 * breakpoints use the 1-hour tier, so those writes must use the 2× rate
 * or DOLLA_AI_MONTHLY_CAP_USD undercounts. `input` excludes tokens reported
 * as cache writes or cache reads — that is how the Messages API usage object works.
 */
export type ModelPrice = {
  inputPerMTokMicroUsd: number;
  outputPerMTokMicroUsd: number;
  cacheWrite5mPerMTokMicroUsd: number;
  cacheWrite1hPerMTokMicroUsd: number;
  cacheReadPerMTokMicroUsd: number;
};

export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-sonnet-5-5": modelPrice(2_000_000, 10_000_000, 100_000),
  "claude-sonnet-5": modelPrice(2_000_000, 10_000_000, 200_000),
  "claude-sonnet-4-6": sonnet46Price(),
  "claude-sonnet-4-5": sonnet46Price(),
  "claude-sonnet-4-5-20250929": sonnet46Price(),
};

/** Used when DOLLA_AI_MODEL is not in the table, so a typo cannot undercount. */
export const FALLBACK_MODEL_PRICE: ModelPrice = sonnet46Price();

function sonnet46Price(): ModelPrice {
  return modelPrice(3_000_000, 15_000_000, 300_000);
}

/** Cache writes follow the published multipliers: 1.25× for 5 minutes, 2× for 1 hour. */
function modelPrice(
  inputPerMTokMicroUsd: number,
  outputPerMTokMicroUsd: number,
  cacheReadPerMTokMicroUsd: number
): ModelPrice {
  return {
    inputPerMTokMicroUsd,
    outputPerMTokMicroUsd,
    cacheWrite5mPerMTokMicroUsd: Math.round((inputPerMTokMicroUsd * 5) / 4),
    cacheWrite1hPerMTokMicroUsd: inputPerMTokMicroUsd * 2,
    cacheReadPerMTokMicroUsd,
  };
}

/**
 * Web search is $10 per 1,000 searches ($0.01 each), on top of token cost.
 * Failed searches are not billed; the API leaves them out of `web_search_requests`.
 */
export const WEB_SEARCH_MICRO_USD_PER_USE = 10_000;

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreation5mTokens: number;
  cacheCreation1hTokens: number;
  cacheReadTokens: number;
  /** Billed web_search uses for this round. Omitted means none. */
  webSearchRequests?: number;
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
    webSearchRequests: 0,
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
  return Math.ceil(numerator / 1_000_000) + searchUses(usage.webSearchRequests) * WEB_SEARCH_MICRO_USD_PER_USE;
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
  server_tool_use?: {
    web_search_requests?: number | null;
  } | null;
}): TokenUsage {
  const five = usage.cache_creation?.ephemeral_5m_input_tokens;
  const hour = usage.cache_creation?.ephemeral_1h_input_tokens;
  const webSearchRequests = searchUses(usage.server_tool_use?.web_search_requests);
  if (typeof five === "number" || typeof hour === "number") {
    return {
      inputTokens: nonNeg(usage.input_tokens),
      outputTokens: nonNeg(usage.output_tokens),
      cacheCreation5mTokens: nonNeg(five),
      cacheCreation1hTokens: nonNeg(hour),
      cacheReadTokens: nonNeg(usage.cache_read_input_tokens),
      webSearchRequests,
    };
  }
  // Breakpoints request ttl "1h". A response that omits the TTL split still
  // created a 1-hour entry; billing it at the 5-minute rate would undercount the cap.
  return {
    inputTokens: nonNeg(usage.input_tokens),
    outputTokens: nonNeg(usage.output_tokens),
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: nonNeg(usage.cache_creation_input_tokens),
    cacheReadTokens: nonNeg(usage.cache_read_input_tokens),
    webSearchRequests,
  };
}

export function microUsdToNumber(micro: number): number {
  return nonNeg(micro) / 1_000_000;
}

function nonNeg(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function searchUses(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
}
