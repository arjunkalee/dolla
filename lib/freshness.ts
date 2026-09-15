import type { AppState, UpcomingBill } from "./types";

export const FEATURED_BILL_IDS = ["bofa", "apple-card", "amex", "rent"] as const;

export function nowISO(now = new Date()): string {
  return now.toISOString();
}

export function billEditChanged(previous: UpcomingBill, next: UpcomingBill): boolean {
  return (
    previous.name !== next.name ||
    previous.amountCents !== next.amountCents ||
    previous.dueDate !== next.dueDate ||
    previous.paid !== next.paid ||
    previous.fromThisCheck !== next.fromThisCheck ||
    previous.kind !== next.kind ||
    previous.paidExpenseId !== next.paidExpenseId
  );
}

export function stampChangedBills(
  previous: UpcomingBill[],
  next: UpcomingBill[],
  stamp: string
): UpcomingBill[] {
  return next.map((bill) => {
    const prior = previous.find((item) => item.id === bill.id);
    if (!prior || billEditChanged(prior, bill)) {
      return { ...bill, updatedAt: stamp };
    }
    return { ...bill, updatedAt: prior.updatedAt };
  });
}

export function stampBill(
  bills: UpcomingBill[],
  id: string,
  stamp: string,
  patch?: Partial<UpcomingBill>
): UpcomingBill[] {
  return bills.map((bill) =>
    bill.id === id ? { ...bill, ...patch, updatedAt: stamp } : bill
  );
}

/** Dated bill with dueDate strictly before Chicago `today` (YYYY-MM-DD). Due today stays unpaid. */
export function isPastDueUnpaid(bill: UpcomingBill, today: string): boolean {
  return Boolean(bill.dueDate) && !bill.paid && bill.dueDate < today;
}

/**
 * Flip past-due unpaid bills to paid. Does not create a payment expense or touch checking —
 * checking already reflects real-world payments. Past-due wins again on the next load.
 */
export function markBillsPastDuePaid(
  state: AppState,
  today: string,
  stamp: string
): { state: AppState; changed: boolean } {
  let changed = false;
  const bills = state.bills.map((bill) => {
    if (!isPastDueUnpaid(bill, today)) return bill;
    changed = true;
    return { ...bill, paid: true, updatedAt: stamp };
  });
  if (!changed) return { state, changed: false };
  return { state: { ...state, bills }, changed: true };
}

export function sortBillsForEdit(bills: UpcomingBill[]): UpcomingBill[] {
  const rank = new Map<string, number>(FEATURED_BILL_IDS.map((id, index) => [id, index]));
  return [...bills].sort((a, b) => {
    const aRank = rank.get(a.id) ?? 100;
    const bRank = rank.get(b.id) ?? 100;
    if (aRank !== bRank) return aRank - bRank;
    return a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name);
  });
}
