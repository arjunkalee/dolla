import type { CategoryId, CategoryStatus } from "./types";

/** Spent vs monthly budget for one envelope, from the shared category ledger. */
export type EnvelopeSpend = {
  spentCents: number;
  budgetCents: number;
  remainingCents: number;
  empty: boolean;
};

/**
 * Read one envelope's month-to-date spend from `insights.categories`.
 * That list is the same source as the budget sheet; its sum is Spent this month.
 */
export function envelopeSpend(
  categories: CategoryStatus[],
  categoryId: CategoryId
): EnvelopeSpend {
  const status = categories.find((c) => c.id === categoryId);
  const spentCents = status?.spentCents ?? 0;
  const budgetCents = status?.budgetCents ?? 0;
  const remainingCents = status?.remainingCents ?? budgetCents - spentCents;
  return {
    spentCents,
    budgetCents,
    remainingCents,
    empty: spentCents <= 0,
  };
}
