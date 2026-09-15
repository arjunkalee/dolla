import type { UpcomingBill } from "./types";

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

export function sortBillsForEdit(bills: UpcomingBill[]): UpcomingBill[] {
  const rank = new Map<string, number>(FEATURED_BILL_IDS.map((id, index) => [id, index]));
  return [...bills].sort((a, b) => {
    const aRank = rank.get(a.id) ?? 100;
    const bRank = rank.get(b.id) ?? 100;
    if (aRank !== bRank) return aRank - bRank;
    return a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name);
  });
}
