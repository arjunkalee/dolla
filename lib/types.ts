export const TIMEZONE = "America/Chicago";
export const OWNER_NAME = "Arjun Kale";
export const STATE_VERSION = 2 as const;

export type CategoryKind = "bill" | "flexible";

export type CategoryId =
  | "rent"
  | "gas"
  | "groceries"
  | "dining"
  | "weekends"
  | "utilities"
  | "travel"
  | "misc";

export type SavingsId = "etrade" | "roth" | "hysa";

export type ExpenseSource = "manual" | "csv" | "bill";

export type BillKind = "card" | "rent" | "other";

export type Category = {
  id: CategoryId;
  name: string;
  monthlyBudgetCents: number;
  kind: CategoryKind;
  sortOrder: number;
};

export type Expense = {
  id: string;
  amountCents: number;
  merchant: string;
  note: string;
  categoryId: CategoryId;
  date: string;
  source: ExpenseSource;
  createdAt: string;
  autoCategorized: boolean;
};

export type PaycheckSettings = {
  netCents: number;
  cadence: "biweekly";
  anchorDate: string;
};

export type UpcomingBill = {
  id: string;
  name: string;
  amountCents: number;
  dueDate: string;
  paid: boolean;
  kind: BillKind;
  fromThisCheck: boolean;
  paidExpenseId?: string;
};

export type SavingsBucket = {
  id: SavingsId;
  name: string;
  targetCents: number;
  balanceCents: number;
  note?: string;
};

export type SavingsEvent = {
  id: string;
  bucketId: SavingsId;
  amountCents: number;
  date: string;
  note: string;
  createdAt: string;
};

export type SplitAllocation = {
  categoryId: CategoryId;
  cents: number;
  optedIn: boolean;
};

export type AppState = {
  version: 2;
  profile: {
    name: string;
    timezone: string;
  };
  checkingCents: number;
  paycheck: PaycheckSettings;
  categories: Category[];
  bills: UpcomingBill[];
  expenses: Expense[];
  merchantRules: Record<string, CategoryId>;
  savings: SavingsBucket[];
  savingsEvents: SavingsEvent[];
  splitAllocations: SplitAllocation[];
  chatMessages: ChatMessage[];
  chatPending: "real" | "empty" | null;
  hasSampleData: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "dolla";
  text: string;
  createdAt: string;
};

export type FormulaRow = {
  label: string;
  cents: number;
  role: "start" | "plus" | "minus" | "total";
};

export type Formula = {
  id: string;
  title: string;
  resultCents: number;
  rows: FormulaRow[];
};

export type StoreInfo = {
  backend: "turso" | "kv" | "file";
  durable: boolean;
  label: string;
};

export type SuggestionTone = "now" | "warn" | "cut" | "save" | "good";

export type Suggestion = {
  id: string;
  tone: SuggestionTone;
  title: string;
  detail: string;
};

export type CategoryStatus = {
  id: CategoryId;
  name: string;
  kind: CategoryKind;
  budgetCents: number;
  spentCents: number;
  remainingCents: number;
  pct: number;
  overCents: number;
};

export type Holdback = {
  id: string;
  label: string;
  cents: number;
  note?: string;
};

export type CalendarEvent = {
  date: string;
  kind: "payday" | "bill" | "spend";
  label: string;
  cents: number;
  paid?: boolean;
};

export type PaycheckCoverage = {
  date: string;
  label: string;
  isCurrent: boolean;
  isFuture: boolean;
  covers: { label: string; cents: number }[];
  leftoverCents: number;
  spentSoFarCents: number;
};

export type Insights = {
  todayISO: string;
  monthKey: string;
  monthLabel: string;
  daysInMonth: number;
  daysLeftInMonth: number;
  lastPayday: string;
  nextPayday: string;
  daysLeftInPayPeriod: number;
  daysElapsedInPayPeriod: number;
  paycheckNetCents: number;
  paydaysThisMonth: string[];
  remainingPaydaysThisMonth: string[];
  monthIncomeCents: number;
  monthBudgetCents: number;
  monthSpentCents: number;
  monthRemainingCents: number;
  spentThisPeriodCents: number;
  billsRemainingCents: number;
  flexibleRemainingCents: number;
  billsAssignedThisCheckCents: number;
  savingsSuggestedThisCheckCents: number;
  flexiblePoolThisCheckCents: number;
  leftoverThisCheckCents: number;
  leftoverPaycheckCents: number;
  leftoverCheckingCents: number;
  leftoverPaycheckIfAmexWaitsCents: number;
  leftoverPaycheckIfAmexReservedCents: number;
  leftoverCheckingIfAmexWaitsCents: number;
  leftoverCheckingIfAmexReservedCents: number;
  preDepositCheckingCents: number;
  cardTotalCents: number;
  cardParts: { id: string; name: string; cents: number }[];
  twoWeekParts: { id: string; name: string; monthlyCents: number; halfCents: number }[];
  formulas: Record<string, Formula>;
  safeToSpendTodayCents: number;
  onTrack: boolean;
  onTrackLabel: string;
  paceRatio: number;
  categories: CategoryStatus[];
  suggestions: Suggestion[];
  paycheckPlan: PaycheckCoverage[];
  calendar: CalendarEvent[];
  holdbacks: Holdback[];
  investableThisCheckCents: number;
  investableIfAmexWaitsCents: number;
  investableIfAmexReservedCents: number;
  amexReserved: boolean;
  amexCents: number;
  twoWeekVariableCents: number;
  twoWeekNeedCents: number;
  optedInEnvelopeCents: number;
  splitPlayLeftoverCents: number;
  splitAllocations: Array<SplitAllocation & { name: string; suggestedCents: number }>;
  checkingCents: number;
  savingsSuggestion: {
    leftoverMonthCents: number;
    alreadyParkedCents: number;
    availableCents: number;
    perCheckCents: number;
    split: Record<SavingsId, number>;
  };
  store: StoreInfo;
};

export type BootstrapResponse = {
  state: AppState;
  insights: Insights;
};
