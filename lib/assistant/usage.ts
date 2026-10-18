import { monthKey, todayISO } from "@/lib/dates";
import { readJsonKey, updateJsonKey } from "@/lib/store";
import { microUsdToNumber, type TokenUsage } from "./pricing";

export const AI_USAGE_KEY = "dolla:ai-usage";
export const RATE_LIMIT_PER_MINUTE = 10;
export const RATE_WINDOW_MS = 60_000;
export const DEFAULT_MONTHLY_CAP_USD = 10;

export type AiMonthUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheCreation5mTokens: number;
  cacheCreation1hTokens: number;
  cacheReadTokens: number;
  costMicroUsd: number;
  requests: number;
};

export type AiUsageLedger = {
  months: Record<string, AiMonthUsage>;
  recentRequestAt: number[];
};

export function emptyMonth(): AiMonthUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
    cacheReadTokens: 0,
    costMicroUsd: 0,
    requests: 0,
  };
}

export function emptyAiUsage(): AiUsageLedger {
  return { months: {}, recentRequestAt: [] };
}

export function usageMonthKey(now = new Date()): string {
  return monthKey(todayISO(now));
}

export function monthlyCapMicroUsd(env: Record<string, string | undefined> = process.env): number {
  const raw = env.DOLLA_AI_MONTHLY_CAP_USD?.trim();
  if (!raw) return DEFAULT_MONTHLY_CAP_USD * 1_000_000;
  const dollars = Number(raw);
  if (!Number.isFinite(dollars) || dollars < 0) return DEFAULT_MONTHLY_CAP_USD * 1_000_000;
  return Math.round(dollars * 1_000_000);
}

export function capReached(spentMicroUsd: number, capMicroUsd: number): boolean {
  return spentMicroUsd >= capMicroUsd;
}

export function capBlockMessage(spentMicroUsd: number, capMicroUsd: number): string {
  const spent = formatCapUsd(spentMicroUsd);
  const cap = formatCapUsd(capMicroUsd);
  return `This month's assistant budget is used up (${spent} of ${cap}). It resets on the 1st, Chicago time. Commands like "log $10 dining" still work. I can't make edits yet.`;
}

export function normalizeAiUsage(raw: unknown): AiUsageLedger {
  if (!raw || typeof raw !== "object") return emptyAiUsage();
  const value = raw as Partial<AiUsageLedger>;
  const months: Record<string, AiMonthUsage> = {};
  if (value.months && typeof value.months === "object") {
    for (const [key, row] of Object.entries(value.months)) {
      if (!/^\d{4}-\d{2}$/.test(key) || !row || typeof row !== "object") continue;
      const record = row as Partial<AiMonthUsage>;
      months[key] = {
        inputTokens: nonNegInt(record.inputTokens),
        outputTokens: nonNegInt(record.outputTokens),
        cacheCreation5mTokens: nonNegInt(record.cacheCreation5mTokens),
        cacheCreation1hTokens: nonNegInt(record.cacheCreation1hTokens),
        cacheReadTokens: nonNegInt(record.cacheReadTokens),
        costMicroUsd: nonNegInt(record.costMicroUsd),
        requests: nonNegInt(record.requests),
      };
    }
  }
  const recentRequestAt = Array.isArray(value.recentRequestAt)
    ? value.recentRequestAt.filter((stamp) => typeof stamp === "number" && Number.isFinite(stamp))
    : [];
  return { months, recentRequestAt };
}

export function pruneRateWindow(stamps: number[], nowMs: number, windowMs = RATE_WINDOW_MS): number[] {
  return stamps.filter((stamp) => nowMs - stamp < windowMs && stamp <= nowMs + 1_000);
}

export function reserveRequest(
  ledger: AiUsageLedger,
  nowMs: number,
  limit = RATE_LIMIT_PER_MINUTE
): { ledger: AiUsageLedger; allowed: boolean } {
  const recent = pruneRateWindow(ledger.recentRequestAt, nowMs);
  if (recent.length >= limit) {
    return { ledger: { ...ledger, recentRequestAt: recent }, allowed: false };
  }
  return { ledger: { ...ledger, recentRequestAt: [...recent, nowMs] }, allowed: true };
}

export function addRequestUsage(
  ledger: AiUsageLedger,
  month: string,
  usage: TokenUsage,
  costMicro: number
): AiUsageLedger {
  const current = ledger.months[month] ?? emptyMonth();
  const months = trimMonths(
    {
      ...ledger.months,
      [month]: {
        inputTokens: current.inputTokens + nonNegInt(usage.inputTokens),
        outputTokens: current.outputTokens + nonNegInt(usage.outputTokens),
        cacheCreation5mTokens: current.cacheCreation5mTokens + nonNegInt(usage.cacheCreation5mTokens),
        cacheCreation1hTokens: current.cacheCreation1hTokens + nonNegInt(usage.cacheCreation1hTokens),
        cacheReadTokens: current.cacheReadTokens + nonNegInt(usage.cacheReadTokens),
        costMicroUsd: current.costMicroUsd + nonNegInt(costMicro),
        requests: current.requests + 1,
      },
    },
    month
  );
  return { ...ledger, months };
}

export type MonthSpend = {
  monthKey: string;
  monthSpendUsd: number;
  capUsd: number;
  monthSpendMicroUsd: number;
  capMicroUsd: number;
  requests: number;
  /** First day of the Chicago month. The cap starts over on this date. */
  resetOn: string;
};

export function usageResetOn(month: string): string {
  return `${month}-01`;
}

export function monthSpendFromLedger(
  ledger: AiUsageLedger,
  now = new Date(),
  env: Record<string, string | undefined> = process.env
): MonthSpend {
  const key = usageMonthKey(now);
  const capMicroUsd = monthlyCapMicroUsd(env);
  const month = ledger.months[key];
  const monthSpendMicroUsd = month?.costMicroUsd ?? 0;
  return {
    monthKey: key,
    monthSpendMicroUsd,
    capMicroUsd,
    monthSpendUsd: microUsdToNumber(monthSpendMicroUsd),
    capUsd: microUsdToNumber(capMicroUsd),
    requests: month?.requests ?? 0,
    resetOn: usageResetOn(key),
  };
}

export async function readMonthSpend(
  now = new Date(),
  env: Record<string, string | undefined> = process.env
): Promise<MonthSpend> {
  const raw = await readJsonKey<unknown>(AI_USAGE_KEY);
  return monthSpendFromLedger(normalizeAiUsage(raw), now, env);
}

export async function mutateAiUsage(
  mutator: (ledger: AiUsageLedger) => AiUsageLedger
): Promise<AiUsageLedger> {
  const next = await updateJsonKey<AiUsageLedger>(AI_USAGE_KEY, emptyAiUsage(), (current) =>
    mutator(normalizeAiUsage(current))
  );
  return normalizeAiUsage(next);
}

function trimMonths(months: Record<string, AiMonthUsage>, current: string): Record<string, AiMonthUsage> {
  const keys = Object.keys(months).sort();
  const keep = new Set(keys.slice(-24));
  keep.add(current);
  const next: Record<string, AiMonthUsage> = {};
  for (const key of keys) {
    if (keep.has(key)) next[key] = months[key]!;
  }
  return next;
}

function nonNegInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
}

function formatCapUsd(micro: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(microUsdToNumber(micro));
}
