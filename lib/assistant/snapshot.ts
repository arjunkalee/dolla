import { budgetBreakdown } from "@/lib/budget-share";
import { formatAsOf, todayISO } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { computeInsights } from "@/lib/plan";
import type { AppState } from "@/lib/types";

/** Compact ledger snapshot. This goes in the user message, never the cached system prompt. */
export function buildStateSnapshot(state: AppState, now = new Date()): string {
  const today = todayISO(now);
  const insights = computeInsights(state, today, {
    backend: "file",
    durable: true,
    label: "snapshot",
  });
  const breakdown = budgetBreakdown({
    envelopes: insights.categories.map((category) => ({
      id: category.id,
      name: category.name,
      cents: category.budgetCents,
    })),
    monthIncomeCents: insights.monthIncomeCents,
    leftoverMonthCents: insights.savingsSuggestion.leftoverMonthCents,
  });

  const lines: string[] = [
    `today: ${today} America/Chicago`,
    `month: ${insights.monthLabel} (${insights.monthKey})`,
  ];

  if (typeof state.checkingCents === "number" && Number.isFinite(state.checkingCents)) {
    const asOf = formatAsOf(state.checkingUpdatedAt);
    lines.push(
      `checking: ${formatCents(state.checkingCents)}${asOf ? ` (${asOf})` : ""}`
    );
  }

  lines.push(
    `paycheck: ${formatCents(state.paycheck.netCents)} biweekly, anchor ${state.paycheck.anchorDate}`,
    `paydays this month: ${insights.paydaysThisMonth.join(", ") || "none"}`,
    `next payday: ${insights.nextPayday}`,
    `take-home this month: ${formatCents(breakdown.takeHomeCents)}`,
    `envelopes total: ${formatCents(breakdown.envelopeCents)}`,
    `invest leftover (take-home minus envelopes, floored at $0): ${formatCents(breakdown.investCents)}`,
    `budget percents: ${breakdown.shares.map((share) => `${share.name} ${share.percent}%`).join(", ")}`,
    "envelopes (budget / spent this month / left):"
  );

  for (const category of insights.categories) {
    lines.push(
      `- ${category.name} [${category.kind}]: ${formatCents(category.budgetCents)} / ${formatCents(category.spentCents)} / ${formatCents(category.remainingCents)}`
    );
  }

  lines.push("bills:");
  if (state.bills.length === 0) {
    lines.push("- none");
  } else {
    for (const bill of state.bills) {
      const when = bill.fromThisCheck ? "this paycheck" : "next paycheck";
      const paid = bill.paid ? "paid" : "unpaid";
      lines.push(
        `- ${bill.name}: ${formatCents(bill.amountCents)} due ${bill.dueDate} ${paid}, ${when}`
      );
    }
  }

  return lines.join("\n");
}
