/**
 * Monthly budget shares for the Budget tab.
 * Envelope amounts come from the budget sheet (`insights.categories`).
 * Invest is the month leftover after those envelopes, clamped at $0.
 * Percentage math stays in `largestRemainderPercents`. Display helpers
 * only choose whether a dollar figure is included next to those percents.
 */

import { formatCents } from "./money";

export const INVEST_SHARE_ID = "invest";

/** Distinct slice colors. The list row uses the same value as the pie. */
export const BUDGET_SLICE_COLORS: Record<string, string> = {
  rent: "oklch(0.73 0.12 250)",
  gas: "oklch(0.80 0.14 95)",
  groceries: "oklch(0.74 0.15 155)",
  dining: "oklch(0.74 0.16 35)",
  weekends: "oklch(0.73 0.14 310)",
  utilities: "oklch(0.76 0.11 210)",
  travel: "oklch(0.75 0.13 175)",
  misc: "oklch(0.74 0.07 70)",
  invest: "oklch(0.84 0.16 145)",
};

export function budgetSliceColor(id: string): string {
  return BUDGET_SLICE_COLORS[id] ?? "oklch(0.72 0.04 145)";
}

export type BudgetShareInput = {
  id: string;
  name: string;
  cents: number;
};

export type BudgetShare = BudgetShareInput & {
  percent: number;
  color: string;
};

/**
 * Integer percentages that sum to 100, by the largest-remainder method.
 * A zero total stays all zeros.
 */
export function largestRemainderPercents(amounts: readonly number[]): number[] {
  const safe = amounts.map((amount) => {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    return Math.round(amount);
  });
  const total = safe.reduce((sum, amount) => sum + amount, 0);
  if (total <= 0) return safe.map(() => 0);

  const floors = safe.map((amount) => Math.floor((amount * 100) / total));
  const remainders = safe.map((amount) => (amount * 100) % total);
  let left = 100 - floors.reduce((sum, amount) => sum + amount, 0);
  if (left < 0) left = 0;

  const order = remainders
    .map((remainder, index) => ({
      remainder,
      index,
      amount: safe[index] ?? 0,
    }))
    .sort(
      (a, b) => b.remainder - a.remainder || b.amount - a.amount || a.index - b.index
    );

  const percents = floors.slice();
  for (let i = 0; i < left && i < order.length; i++) {
    const pick = order[i];
    if (!pick) break;
    percents[pick.index] = (percents[pick.index] ?? 0) + 1;
  }
  return percents;
}

/**
 * Invest for the month.
 * Prefer the plan's leftover after envelopes when it is provided
 * (`savingsSuggestion.leftoverMonthCents`). Otherwise use take-home minus
 * the envelope sum. Negative leftover is $0.
 */
export function monthlyInvestCents(input: {
  monthIncomeCents: number;
  envelopeCents: number;
  leftoverMonthCents?: number;
}): number {
  const raw =
    typeof input.leftoverMonthCents === "number"
      ? input.leftoverMonthCents
      : input.monthIncomeCents - input.envelopeCents;
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.round(raw);
}

export function budgetBreakdown(input: {
  envelopes: BudgetShareInput[];
  monthIncomeCents: number;
  leftoverMonthCents?: number;
}): {
  takeHomeCents: number;
  envelopeCents: number;
  investCents: number;
  totalCents: number;
  shares: BudgetShare[];
} {
  const envelopes = input.envelopes.map((envelope) => ({
    id: envelope.id,
    name: envelope.name,
    cents:
      Number.isFinite(envelope.cents) && envelope.cents > 0
        ? Math.round(envelope.cents)
        : 0,
  }));
  const envelopeCents = envelopes.reduce((sum, envelope) => sum + envelope.cents, 0);
  const investCents = monthlyInvestCents({
    monthIncomeCents: input.monthIncomeCents,
    envelopeCents,
    leftoverMonthCents: input.leftoverMonthCents,
  });
  const rows: BudgetShareInput[] = [
    ...envelopes,
    { id: INVEST_SHARE_ID, name: "Invest", cents: investCents },
  ];
  const percents = largestRemainderPercents(rows.map((row) => row.cents));
  const takeHomeCents =
    Number.isFinite(input.monthIncomeCents) && input.monthIncomeCents > 0
      ? Math.round(input.monthIncomeCents)
      : 0;

  return {
    takeHomeCents,
    envelopeCents,
    investCents,
    totalCents: envelopeCents + investCents,
    shares: rows.map((row, index) => ({
      ...row,
      percent: percents[index] ?? 0,
      color: budgetSliceColor(row.id),
    })),
  };
}

/**
 * Outside the donut, only slices this wide stay readable on a phone.
 * Smaller slices keep their percent in the tooltip and the list.
 */
export const PIE_LABEL_MIN_PERCENT = 8;

export function pieShowsOutsideLabel(percent: number): boolean {
  return percent >= PIE_LABEL_MIN_PERCENT;
}

/** Name plus percent, with the dollar amount only when it is meant to be visible. */
export function budgetSliceCaption(
  share: Pick<BudgetShare, "name" | "cents" | "percent">,
  hideDollars: boolean
): string {
  if (hideDollars) return `${share.name} · ${share.percent}%`;
  return `${share.name} · ${formatCents(share.cents)} · ${share.percent}%`;
}

/** Center of the pie: the total in dollars, or 100% when amounts are hidden. */
export function budgetCenterText(totalCents: number, hideDollars: boolean): string {
  if (hideDollars) return totalCents > 0 ? "100%" : "0%";
  return formatCents(totalCents);
}

export function budgetTakeHomeNote(overTakeHome: boolean, hideDollars: boolean): string {
  if (!overTakeHome) {
    return "Envelopes plus Invest, the leftover after those envelopes.";
  }
  return hideDollars
    ? "Envelopes are above take-home, so Invest is 0%."
    : "Envelopes are above take-home, so Invest is $0.";
}
