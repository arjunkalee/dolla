import { INVEST_SHARE_ID, type BudgetShare } from "./budget-share";
import { formatCents } from "./money";
import type { Expense } from "./types";

/** Query key for the Budget tab category drilldown. The path stays `/budget`. */
export const BUDGET_CATEGORY_QUERY = "category";

export function budgetCategoryHref(categoryId: string): string {
  const params = new URLSearchParams();
  params.set(BUDGET_CATEGORY_QUERY, categoryId);
  return `/budget?${params.toString()}`;
}

export type CategoryExpenseSource = Pick<
  Expense,
  "id" | "merchant" | "amountCents" | "categoryId" | "date" | "createdAt"
>;

export type CategoryExpenseRow = {
  id: string;
  merchant: string;
  date: string;
  amountCents: number;
};

/**
 * Expenses dated in `monthKey` (YYYY-MM) for one category, newest first.
 * Same month rule as spent-this-month: `date` starts with that key.
 * A later `createdAt` wins when two charges fall on the same day.
 */
export function monthCategoryExpenses<T extends Pick<Expense, "categoryId" | "date" | "createdAt">>(
  expenses: readonly T[],
  categoryId: string,
  monthKey: string
): T[] {
  if (!categoryId || !monthKey) return [];
  return expenses
    .filter((expense) => expense.categoryId === categoryId && expense.date.startsWith(monthKey))
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
}

export function sumExpenseCents(expenses: readonly { amountCents: number }[]): number {
  return expenses.reduce((sum, expense) => sum + expense.amountCents, 0);
}

export type CategoryDrilldown = {
  known: boolean;
  name: string;
  color: string;
  invest: boolean;
  totalCents: number;
  totalLabel: string;
  envelopeCents: number | null;
  percent: number | null;
  rows: CategoryExpenseRow[];
  emptyLabel: string;
};

type DrilldownShare = Pick<BudgetShare, "name" | "cents" | "percent" | "color">;

export function categoryDrilldown(input: {
  categoryId: string;
  monthKey: string;
  expenses: readonly CategoryExpenseSource[];
  share: DrilldownShare | null;
}): CategoryDrilldown {
  if (!input.share) {
    return {
      known: false,
      name: "Budget",
      color: "transparent",
      invest: false,
      totalCents: 0,
      totalLabel: "Spent this month",
      envelopeCents: null,
      percent: null,
      rows: [],
      emptyLabel: "That category isn't on this month's budget.",
    };
  }

  const invest = input.categoryId === INVEST_SHARE_ID;
  const matched = invest
    ? []
    : monthCategoryExpenses(input.expenses, input.categoryId, input.monthKey);
  const rows = matched.map((expense) => ({
    id: expense.id,
    merchant: expense.merchant.trim() || "Purchase",
    date: expense.date,
    amountCents: expense.amountCents,
  }));

  return {
    known: true,
    name: input.share.name,
    color: input.share.color,
    invest,
    totalCents: invest ? input.share.cents : sumExpenseCents(rows),
    totalLabel: invest ? "Left to invest" : "Spent this month",
    envelopeCents: invest ? null : input.share.cents,
    percent: input.share.percent,
    rows,
    emptyLabel: `No spending in ${input.share.name} this month.`,
  };
}

/** One line under the total. Dollar figures stay out when amounts are hidden. */
export function categoryDrilldownSummary(drilldown: CategoryDrilldown, hideDollars: boolean): string {
  if (!drilldown.known) return drilldown.emptyLabel;
  const percent = drilldown.percent ?? 0;
  if (drilldown.invest) {
    return `${percent}% of this month. What's left after the envelopes.`;
  }
  const shareLabel =
    hideDollars || drilldown.envelopeCents === null
      ? `${percent}% of this month`
      : `Envelope ${formatCents(drilldown.envelopeCents)} · ${percent}%`;
  if (drilldown.rows.length === 0) return shareLabel;
  const count = drilldown.rows.length === 1 ? "1 purchase" : `${drilldown.rows.length} purchases`;
  return `${count} · ${shareLabel}`;
}
