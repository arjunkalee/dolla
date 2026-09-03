import type { AppState, Category, SplitAllocation, UpcomingBill } from "./types";
import { OWNER_NAME, TIMEZONE } from "./types";

export const DEFAULT_CATEGORIES: Category[] = [
  { id: "rent", name: "Rent", monthlyBudgetCents: 143_200, kind: "bill", sortOrder: 0 },
  { id: "gas", name: "Gas", monthlyBudgetCents: 10_000, kind: "flexible", sortOrder: 1 },
  { id: "groceries", name: "Groceries", monthlyBudgetCents: 25_000, kind: "flexible", sortOrder: 2 },
  { id: "dining", name: "Restaurant / dining", monthlyBudgetCents: 40_000, kind: "flexible", sortOrder: 3 },
  { id: "weekends", name: "Weekends", monthlyBudgetCents: 15_000, kind: "flexible", sortOrder: 4 },
  { id: "utilities", name: "Utilities / electricity", monthlyBudgetCents: 5_000, kind: "flexible", sortOrder: 5 },
  { id: "travel", name: "Travel", monthlyBudgetCents: 20_000, kind: "flexible", sortOrder: 6 },
  { id: "misc", name: "Misc", monthlyBudgetCents: 20_000, kind: "flexible", sortOrder: 7 },
];

export const DEFAULT_BILLS: UpcomingBill[] = [
  {
    id: "bofa",
    name: "Bank of America card",
    amountCents: 45_475,
    dueDate: "2026-08-30",
    paid: false,
    kind: "card",
    fromThisCheck: true,
  },
  {
    id: "apple-card",
    name: "Apple Card",
    amountCents: 69_426,
    dueDate: "2026-08-30",
    paid: false,
    kind: "card",
    fromThisCheck: true,
  },
  {
    id: "rent",
    name: "Rent",
    amountCents: 143_200,
    dueDate: "2026-09-01",
    paid: false,
    kind: "rent",
    fromThisCheck: true,
  },
  {
    id: "amex",
    name: "Amex",
    amountCents: 141_652,
    dueDate: "2026-09-17",
    paid: false,
    kind: "card",
    fromThisCheck: false,
  },
];

export function defaultSplitAllocations(categories: Category[] = DEFAULT_CATEGORIES): SplitAllocation[] {
  return categories
    .filter((c) => c.kind === "flexible")
    .map((c) => ({
      categoryId: c.id,
      cents: 0,
      optedIn: false,
    }));
}

export function emptyState(now = new Date()): AppState {
  const stamp = now.toISOString();
  return {
    version: 2,
    profile: { name: OWNER_NAME, timezone: TIMEZONE },
    checkingCents: 0,
    paycheck: {
      netCents: 277_155,
      cadence: "biweekly",
      anchorDate: "2026-08-29",
    },
    categories: DEFAULT_CATEGORIES.map((c) => ({ ...c })),
    bills: [],
    expenses: [],
    merchantRules: {},
    savings: [
      { id: "etrade", name: "eTrade / investments", targetCents: 0, balanceCents: 0 },
      { id: "roth", name: "Roth IRA", targetCents: 0, balanceCents: 0 },
      { id: "hysa", name: "HYSA", targetCents: 0, balanceCents: 0 },
    ],
    savingsEvents: [],
    splitAllocations: defaultSplitAllocations(),
    chatMessages: [],
    chatPending: null,
    hasSampleData: false,
    createdAt: stamp,
    updatedAt: stamp,
  };
}

/** Arjun's real starting ledger as of Sat Aug 29, 2026. No sample purchases. */
export function realState(now = new Date()): AppState {
  const stamp = now.toISOString();
  const state = emptyState(now);
  state.checkingCents = 495_201;
  state.paycheck = {
    netCents: 277_155,
    cadence: "biweekly",
    anchorDate: "2026-08-29",
  };
  state.bills = DEFAULT_BILLS.map((b) => ({ ...b }));
  state.createdAt = stamp;
  state.updatedAt = stamp;
  return state;
}

/** @deprecated Use realState — kept so older reset("sample") reloads the real ledger. */
export function seededState(now = new Date()): AppState {
  return realState(now);
}
