import { nanoid } from "nanoid";
import { parseChat } from "./chat";
import { rememberMerchant, suggestCategory, UNCATEGORIZED_CATEGORY_ID } from "./categorize";
import { importCsv } from "./csv";
import { todayISO } from "./dates";
import { formatCents } from "./money";
import { computeInsights, leftoverSummary } from "./plan";
import { emptyState, realState } from "./seed";
import { loadState, saveState, storeInfo, updateState } from "./store";
import type {
  AppState,
  BootstrapResponse,
  Category,
  CategoryId,
  ChatMessage,
  Expense,
  PaycheckSettings,
  SavingsId,
  SplitAllocation,
  UpcomingBill,
} from "./types";

export async function bootstrap(): Promise<BootstrapResponse> {
  const state = await loadState();
  return pack(state);
}

export async function logPurchase(input: {
  amountCents: number;
  merchant: string;
  note?: string;
  categoryId?: CategoryId;
  date?: string;
}): Promise<BootstrapResponse> {
  if (!input.amountCents || input.amountCents <= 0) {
    throw new Error("Amount must be greater than zero.");
  }
  const merchant = input.merchant.trim();
  if (!merchant) throw new Error("Merchant is required.");
  const today = todayISO();
  const date = input.date && input.date <= today ? input.date : today;

  const state = await updateState((current) => {
    const suggested = suggestCategory(merchant, current.merchantRules);
    const categoryId = input.categoryId ?? suggested.categoryId;
    const autoCategorized = !input.categoryId || input.categoryId === suggested.categoryId;
    const expense: Expense = {
      id: nanoid(),
      amountCents: input.amountCents,
      merchant,
      note: input.note?.trim() ?? "",
      categoryId,
      date,
      source: "manual",
      createdAt: new Date().toISOString(),
      autoCategorized,
    };
    let merchantRules = current.merchantRules;
    if (input.categoryId && input.categoryId !== suggested.categoryId) {
      merchantRules = rememberMerchant(merchantRules, merchant, input.categoryId);
    } else if (suggested.source === "heuristic" || suggested.source === "rule") {
      merchantRules = rememberMerchant(merchantRules, merchant, categoryId);
    }
    return {
      ...current,
      checkingCents: current.checkingCents - input.amountCents,
      expenses: [expense, ...current.expenses],
      merchantRules,
    };
  });
  return pack(state);
}

export async function recategorizeExpense(
  id: string,
  categoryId: CategoryId
): Promise<BootstrapResponse> {
  const state = await updateState((current) => {
    const expense = current.expenses.find((e) => e.id === id);
    if (!expense) return current;
    return {
      ...current,
      expenses: current.expenses.map((e) =>
        e.id === id ? { ...e, categoryId, autoCategorized: false } : e
      ),
      merchantRules: rememberMerchant(current.merchantRules, expense.merchant, categoryId),
    };
  });
  return pack(state);
}

export async function deleteExpense(id: string): Promise<BootstrapResponse> {
  const state = await updateState((current) => {
    const expense = current.expenses.find((e) => e.id === id);
    if (!expense) return current;
    return {
      ...current,
      checkingCents: current.checkingCents + expense.amountCents,
      expenses: current.expenses.filter((e) => e.id !== id),
      bills: current.bills.map((b) =>
        b.paidExpenseId === id ? { ...b, paid: false, paidExpenseId: undefined } : b
      ),
    };
  });
  return pack(state);
}

export async function saveBudget(categories: Category[]): Promise<BootstrapResponse> {
  const state = await updateState((current) => ({
    ...current,
    categories: current.categories.map((existing) => {
      const next = categories.find((c) => c.id === existing.id);
      return next
        ? {
            ...existing,
            name: next.name,
            monthlyBudgetCents: Math.max(0, next.monthlyBudgetCents),
            kind: next.kind,
          }
        : existing;
    }),
  }));
  return pack(state);
}

export async function savePaycheck(paycheck: PaycheckSettings): Promise<BootstrapResponse> {
  const state = await updateState((current) => ({
    ...current,
    paycheck: {
      netCents: Math.max(0, paycheck.netCents),
      cadence: "biweekly",
      anchorDate: paycheck.anchorDate,
    },
  }));
  return pack(state);
}

export async function saveChecking(checkingCents: number): Promise<BootstrapResponse> {
  const state = await updateState((current) => ({
    ...current,
    checkingCents: Math.round(checkingCents),
  }));
  return pack(state);
}

export async function saveSplitAllocations(
  allocations: SplitAllocation[]
): Promise<BootstrapResponse> {
  const state = await updateState((current) => ({
    ...current,
    splitAllocations: allocations.map((a) => ({
      categoryId: a.categoryId,
      cents: Math.max(0, Math.round(a.cents)),
      optedIn: Boolean(a.optedIn),
    })),
  }));
  return pack(state);
}

export async function saveBills(bills: UpcomingBill[]): Promise<BootstrapResponse> {
  const state = await updateState((current) => ({
    ...current,
    bills: bills.map((b) => ({
      ...b,
      name: b.name.trim() || "Bill",
      amountCents: Math.max(0, b.amountCents),
    })),
  }));
  return pack(state);
}

export async function setBillFromThisCheck(
  id: string,
  fromThisCheck: boolean
): Promise<BootstrapResponse> {
  const state = await updateState((current) => ({
    ...current,
    bills: current.bills.map((b) => (b.id === id ? { ...b, fromThisCheck } : b)),
  }));
  return pack(state);
}

export async function setBillPaid(id: string, paid: boolean): Promise<BootstrapResponse> {
  const today = todayISO();
  const state = await updateState((current) => {
    const bill = current.bills.find((b) => b.id === id);
    if (!bill || bill.paid === paid) return current;

    if (paid) {
      const categoryId: CategoryId = bill.kind === "rent" ? "rent" : "misc";
      const expense: Expense = {
        id: nanoid(),
        amountCents: bill.amountCents,
        merchant: bill.name,
        note: `Paid · due ${bill.dueDate}`,
        categoryId,
        date: today,
        source: "bill",
        createdAt: new Date().toISOString(),
        autoCategorized: false,
      };
      return {
        ...current,
        checkingCents: current.checkingCents - bill.amountCents,
        expenses: [expense, ...current.expenses],
        bills: current.bills.map((b) =>
          b.id === id ? { ...b, paid: true, paidExpenseId: expense.id } : b
        ),
      };
    }

    const refund = bill.paidExpenseId
      ? current.expenses.find((e) => e.id === bill.paidExpenseId)
      : undefined;
    return {
      ...current,
      checkingCents: current.checkingCents + (refund?.amountCents ?? bill.amountCents),
      expenses: bill.paidExpenseId
        ? current.expenses.filter((e) => e.id !== bill.paidExpenseId)
        : current.expenses,
      bills: current.bills.map((b) =>
        b.id === id ? { ...b, paid: false, paidExpenseId: undefined } : b
      ),
    };
  });
  return pack(state);
}

export async function saveSavingsTargets(
  buckets: AppState["savings"]
): Promise<BootstrapResponse> {
  const state = await updateState((current) => ({
    ...current,
    savings: current.savings.map((bucket) => {
      const next = buckets.find((b) => b.id === bucket.id);
      return next
        ? {
            ...bucket,
            targetCents: Math.max(0, next.targetCents),
            name: next.name,
          }
        : bucket;
    }),
  }));
  return pack(state);
}

export async function confirmSetAsides(input: {
  date?: string;
  amounts: Partial<Record<SavingsId, number>>;
}): Promise<BootstrapResponse> {
  const today = todayISO();
  const date = input.date && input.date <= today ? input.date : today;
  const state = await updateState((current) => {
    const events = [...current.savingsEvents];
    const savings = current.savings.map((bucket) => ({ ...bucket }));
    let checking = current.checkingCents;
    for (const id of ["etrade", "roth", "hysa"] as SavingsId[]) {
      const amount = input.amounts[id] ?? 0;
      if (amount <= 0) continue;
      events.unshift({
        id: nanoid(),
        bucketId: id,
        amountCents: amount,
        date,
        note: "Paycheck set-aside",
        createdAt: new Date().toISOString(),
      });
      const bucket = savings.find((b) => b.id === id);
      if (bucket) bucket.balanceCents += amount;
      checking -= amount;
    }
    return { ...current, savings, savingsEvents: events, checkingCents: checking };
  });
  return pack(state);
}

export async function importStatement(csvText: string): Promise<BootstrapResponse & { importMeta: { added: number; skipped: number; duplicates: number; errors: string[] } }> {
  const today = todayISO();
  const createdAt = new Date().toISOString();
  let meta = { added: 0, skipped: 0, duplicates: 0, errors: [] as string[] };
  const state = await updateState((current) => {
    const result = importCsv(current, csvText, today, createdAt);
    meta = {
      added: result.added.length,
      skipped: result.skipped,
      duplicates: result.duplicates,
      errors: result.errors,
    };
    let merchantRules = current.merchantRules;
    let checking = current.checkingCents;
    for (const expense of result.added) {
      if (!(expense.autoCategorized && expense.categoryId === UNCATEGORIZED_CATEGORY_ID)) {
        merchantRules = rememberMerchant(merchantRules, expense.merchant, expense.categoryId);
      }
      checking -= expense.amountCents;
    }
    return {
      ...current,
      checkingCents: checking,
      expenses: [...result.added, ...current.expenses],
      merchantRules,
    };
  });
  return { ...pack(state), importMeta: meta };
}

export type ResetMode = "sample" | "empty" | "keep-settings" | "real";

/** Profile sends `"real"`; `"sample"` is the same Aug 29 snapshot. Unknown modes also reload it. */
export function parseResetMode(mode: unknown): ResetMode {
  if (mode === "empty" || mode === "keep-settings" || mode === "real" || mode === "sample") {
    return mode;
  }
  return "real";
}

export async function resetData(mode: ResetMode): Promise<BootstrapResponse> {
  const current = await loadState();
  let next: AppState;
  if (mode === "empty") {
    next = emptyState();
  } else if (mode === "keep-settings") {
    next = {
      ...current,
      expenses: [],
      savingsEvents: [],
      hasSampleData: false,
    };
  } else {
    next = realState();
  }
  const saved = await saveState(next);
  return pack(saved);
}

const HELP = [
  "I only change numbers you name. Try:",
  "checking is 5100",
  "$10 for restaurant",
  "change groceries to 300",
  "restaurant envelope is 400",
  "Apple Card is paid",
  "paycheck is 2771.55",
  "reserve amex / amex next paycheck",
  "log 12.34 at Starbucks",
].join("\n");

function pushChat(state: AppState, userText: string, reply: string): AppState {
  const now = new Date().toISOString();
  const user: ChatMessage = { id: nanoid(), role: "user", text: userText, createdAt: now };
  const dolla: ChatMessage = { id: nanoid(), role: "dolla", text: reply, createdAt: now };
  return { ...state, chatMessages: [...state.chatMessages, user, dolla].slice(-40) };
}

export async function applyChatMessage(text: string): Promise<BootstrapResponse> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Type something to change.");

  const current = await loadState();
  const intent = parseChat(trimmed, current);

  if (intent.type === "help") {
    return pack(await saveState(pushChat(current, trimmed, HELP)));
  }
  if (intent.type === "unknown") {
    return pack(
      await saveState(
        pushChat(
          current,
          trimmed,
          `I didn’t change anything. I only edit named balances.\n\n${HELP}`
        )
      )
    );
  }
  if (intent.type === "ask-wipe") {
    const state = await updateState((s) => ({
      ...pushChat(
        s,
        trimmed,
        intent.mode === "empty"
          ? "That zeros checking and bills. Reply confirm if you want a blank month."
          : "That reloads the Aug 29 starting ledger. Reply confirm to do it."
      ),
      chatPending: intent.mode,
    }));
    return pack(state);
  }
  if (intent.type === "cancel-wipe") {
    const state = await updateState((s) => ({
      ...pushChat(s, trimmed, "Okay — nothing wiped."),
      chatPending: null,
    }));
    return pack(state);
  }
  if (intent.type === "confirm-wipe") {
    const mode = current.chatPending;
    if (!mode) {
      return pack(await saveState(pushChat(current, trimmed, "Nothing pending to confirm.")));
    }
    const next = mode === "empty" ? emptyState() : realState();
    next.chatMessages = pushChat(
      { ...current, chatPending: null },
      trimmed,
      mode === "empty" ? "Blank month loaded." : "Starting ledger reloaded."
    ).chatMessages;
    next.chatPending = null;
    return pack(await saveState(next));
  }

  const state = await updateState((s) => {
    const next = { ...s };
    let note = "";

    if (intent.type === "set-checking") {
      next.checkingCents = intent.cents;
      note = `Checking is now ${formatCents(intent.cents)}.`;
    } else if (intent.type === "set-paycheck") {
      next.paycheck = { ...next.paycheck, netCents: intent.cents };
      note = `Paycheck net is now ${formatCents(intent.cents)}. Checking still has whatever you last set — I did not add this again.`;
    } else if (intent.type === "set-category") {
      next.categories = next.categories.map((c) =>
        c.id === intent.id ? { ...c, monthlyBudgetCents: intent.cents } : c
      );
      const name = next.categories.find((c) => c.id === intent.id)?.name ?? intent.id;
      note = `${name} envelope is now ${formatCents(intent.cents)} / month.`;
    } else if (intent.type === "set-rent-both") {
      next.categories = next.categories.map((c) =>
        c.id === "rent" ? { ...c, monthlyBudgetCents: intent.cents } : c
      );
      next.bills = next.bills.map((b) =>
        b.id === "rent" || b.kind === "rent" ? { ...b, amountCents: intent.cents } : b
      );
      note = `Rent bill and rent envelope are both ${formatCents(intent.cents)}.`;
    } else if (intent.type === "set-bill-amount") {
      next.bills = next.bills.map((b) =>
        b.id === intent.billId ? { ...b, amountCents: intent.cents } : b
      );
      const name = next.bills.find((b) => b.id === intent.billId)?.name ?? "Bill";
      note = `${name} is now ${formatCents(intent.cents)}.`;
    } else if (intent.type === "set-bill-due") {
      next.bills = next.bills.map((b) =>
        b.id === intent.billId ? { ...b, dueDate: intent.date } : b
      );
      const name = next.bills.find((b) => b.id === intent.billId)?.name ?? "Bill";
      note = `${name} due date is ${intent.date}.`;
    } else if (intent.type === "set-bill-paid") {
      const bill = next.bills.find((b) => b.id === intent.billId);
      if (bill && bill.paid !== intent.paid) {
        if (intent.paid) {
          const categoryId: CategoryId = bill.kind === "rent" ? "rent" : "misc";
          const expense: Expense = {
            id: nanoid(),
            amountCents: bill.amountCents,
            merchant: bill.name,
            note: `Paid · due ${bill.dueDate}`,
            categoryId,
            date: todayISO(),
            source: "bill",
            createdAt: new Date().toISOString(),
            autoCategorized: false,
          };
          next.checkingCents -= bill.amountCents;
          next.expenses = [expense, ...next.expenses];
          next.bills = next.bills.map((b) =>
            b.id === intent.billId ? { ...b, paid: true, paidExpenseId: expense.id } : b
          );
          note = `Marked ${bill.name} paid. Subtracted ${formatCents(bill.amountCents)} from checking.`;
        } else {
          const refund = bill.paidExpenseId
            ? next.expenses.find((e) => e.id === bill.paidExpenseId)
            : undefined;
          next.checkingCents += refund?.amountCents ?? bill.amountCents;
          next.expenses = bill.paidExpenseId
            ? next.expenses.filter((e) => e.id !== bill.paidExpenseId)
            : next.expenses;
          next.bills = next.bills.map((b) =>
            b.id === intent.billId ? { ...b, paid: false, paidExpenseId: undefined } : b
          );
          note = `Marked ${bill.name} unpaid. Added the amount back to checking.`;
        }
      } else {
        note = bill ? `${bill.name} was already ${intent.paid ? "paid" : "unpaid"}.` : "No matching bill.";
      }
    } else if (intent.type === "set-from-check") {
      next.bills = next.bills.map((b) =>
        b.id === intent.billId ? { ...b, fromThisCheck: intent.fromThisCheck } : b
      );
      const name = next.bills.find((b) => b.id === intent.billId)?.name ?? "Bill";
      note = intent.fromThisCheck
        ? `${name} is reserved from this paycheck.`
        : `${name} waits for the next paycheck.`;
    } else if (intent.type === "log-expense") {
      const suggested = suggestCategory(intent.merchant, next.merchantRules);
      const categoryId = intent.categoryId ?? suggested.categoryId;
      const expense: Expense = {
        id: nanoid(),
        amountCents: intent.cents,
        merchant: intent.merchant,
        note: "",
        categoryId,
        date: todayISO(),
        source: "manual",
        createdAt: new Date().toISOString(),
        autoCategorized: !intent.categoryId,
      };
      next.checkingCents -= intent.cents;
      next.expenses = [expense, ...next.expenses];
      next.merchantRules = rememberMerchant(next.merchantRules, intent.merchant, categoryId);
      note = `Logged ${formatCents(intent.cents)} at ${intent.merchant} → ${next.categories.find((c) => c.id === categoryId)?.name ?? categoryId}. Checking ${formatCents(next.checkingCents)}.`;
    }

    const preview = computeInsights(next, todayISO(), storeInfo());
    const reply = `${note}\n\n${leftoverSummary(preview)}`;
    return { ...pushChat(next, trimmed, reply), chatPending: null };
  });
  return pack(state);
}

function pack(state: AppState): BootstrapResponse {
  return {
    state,
    insights: computeInsights(state, todayISO(), storeInfo()),
  };
}
