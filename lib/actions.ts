import { nanoid } from "nanoid";
import { parseChat } from "./chat";
import { rememberMerchant, suggestCategory, UNCATEGORIZED_CATEGORY_ID } from "./categorize";
import { importCsv, type CsvImportMeta } from "./csv";
import { todayISO } from "./dates";
import { markBillsPastDuePaid, nowISO, stampBill, stampChangedBills } from "./freshness";
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

/** Load AppState, auto-mark past-due bills paid (no checking side effects), persist if anything flipped. */
export async function bootstrap(): Promise<BootstrapResponse> {
  const loaded = await loadState();
  const settled = markBillsPastDuePaid(loaded, todayISO(), nowISO());
  const state = settled.changed ? await saveState(settled.state) : loaded;
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
  const stamp = nowISO();

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
      createdAt: stamp,
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
      checkingUpdatedAt: stamp,
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
  const stamp = nowISO();
  const state = await updateState((current) => {
    const expense = current.expenses.find((e) => e.id === id);
    if (!expense) return current;
    return {
      ...current,
      checkingCents: current.checkingCents + expense.amountCents,
      checkingUpdatedAt: stamp,
      expenses: current.expenses.filter((e) => e.id !== id),
      bills: current.bills.map((b) =>
        b.paidExpenseId === id
          ? { ...b, paid: false, paidExpenseId: undefined, updatedAt: stamp }
          : b
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
  const stamp = nowISO();
  const state = await updateState((current) => ({
    ...current,
    checkingCents: Math.round(checkingCents),
    checkingUpdatedAt: stamp,
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
  const stamp = nowISO();
  const state = await updateState((current) => ({
    ...current,
    bills: stampChangedBills(
      current.bills,
      bills.map((b) => ({
        ...b,
        name: b.name.trim() || "Bill",
        amountCents: Math.max(0, b.amountCents),
      })),
      stamp
    ),
  }));
  return pack(state);
}

export async function setBillFromThisCheck(
  id: string,
  fromThisCheck: boolean
): Promise<BootstrapResponse> {
  const stamp = nowISO();
  const state = await updateState((current) => {
    const bill = current.bills.find((b) => b.id === id);
    if (!bill || bill.fromThisCheck === fromThisCheck) return current;
    return {
      ...current,
      bills: stampBill(current.bills, id, stamp, { fromThisCheck }),
    };
  });
  return pack(state);
}

/** Reverse a manual bill payment. Auto-marked past-due bills have no expense — do not invent checking cash. */
function unpayBill(current: AppState, bill: UpcomingBill, stamp: string): AppState {
  const linked = bill.paidExpenseId
    ? current.expenses.find((e) => e.id === bill.paidExpenseId)
    : undefined;
  const refundCents = bill.paidExpenseId ? (linked?.amountCents ?? bill.amountCents) : 0;
  return {
    ...current,
    checkingCents: current.checkingCents + refundCents,
    checkingUpdatedAt: refundCents ? stamp : current.checkingUpdatedAt,
    expenses: bill.paidExpenseId
      ? current.expenses.filter((e) => e.id !== bill.paidExpenseId)
      : current.expenses,
    bills: stampBill(current.bills, bill.id, stamp, { paid: false, paidExpenseId: undefined }),
  };
}

export async function setBillPaid(id: string, paid: boolean): Promise<BootstrapResponse> {
  const today = todayISO();
  const stamp = nowISO();
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
        createdAt: stamp,
        autoCategorized: false,
      };
      return {
        ...current,
        checkingCents: current.checkingCents - bill.amountCents,
        checkingUpdatedAt: stamp,
        expenses: [expense, ...current.expenses],
        bills: stampBill(current.bills, id, stamp, { paid: true, paidExpenseId: expense.id }),
      };
    }

    return unpayBill(current, bill, stamp);
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
  const stamp = nowISO();
  const state = await updateState((current) => {
    const events = [...current.savingsEvents];
    const savings = current.savings.map((bucket) => ({ ...bucket }));
    let checking = current.checkingCents;
    let moved = false;
    for (const id of ["etrade", "roth", "hysa"] as SavingsId[]) {
      const amount = input.amounts[id] ?? 0;
      if (amount <= 0) continue;
      moved = true;
      events.unshift({
        id: nanoid(),
        bucketId: id,
        amountCents: amount,
        date,
        note: "Paycheck set-aside",
        createdAt: stamp,
      });
      const bucket = savings.find((b) => b.id === id);
      if (bucket) bucket.balanceCents += amount;
      checking -= amount;
    }
    return {
      ...current,
      savings,
      savingsEvents: events,
      checkingCents: checking,
      checkingUpdatedAt: moved ? stamp : current.checkingUpdatedAt,
    };
  });
  return pack(state);
}

export async function importStatement(
  csvText: string
): Promise<BootstrapResponse & { importMeta: CsvImportMeta }> {
  const today = todayISO();
  const createdAt = new Date().toISOString();
  let meta: CsvImportMeta = { added: 0, skipped: 0, duplicates: 0, errors: [] };
  const state = await updateState((current) => {
    const result = importCsv(current, csvText, today, createdAt);
    meta = {
      added: result.added.length,
      skipped: result.skipped,
      duplicates: result.duplicates,
      errors: result.errors,
      suggestedCheckingCents: result.suggestedCheckingCents,
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
      checkingUpdatedAt: result.added.length > 0 ? createdAt : current.checkingUpdatedAt,
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
    const stamp = nowISO();
    let note = "";

    if (intent.type === "set-checking") {
      next.checkingCents = intent.cents;
      next.checkingUpdatedAt = stamp;
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
        b.id === "rent" || b.kind === "rent"
          ? { ...b, amountCents: intent.cents, updatedAt: stamp }
          : b
      );
      note = `Rent bill and rent envelope are both ${formatCents(intent.cents)}.`;
    } else if (intent.type === "set-bill-amount") {
      next.bills = stampBill(next.bills, intent.billId, stamp, { amountCents: intent.cents });
      const name = next.bills.find((b) => b.id === intent.billId)?.name ?? "Bill";
      note = `${name} is now ${formatCents(intent.cents)}.`;
    } else if (intent.type === "set-bill-due") {
      next.bills = stampBill(next.bills, intent.billId, stamp, { dueDate: intent.date });
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
            createdAt: stamp,
            autoCategorized: false,
          };
          next.checkingCents -= bill.amountCents;
          next.checkingUpdatedAt = stamp;
          next.expenses = [expense, ...next.expenses];
          next.bills = stampBill(next.bills, intent.billId, stamp, {
            paid: true,
            paidExpenseId: expense.id,
          });
          note = `Marked ${bill.name} paid. Subtracted ${formatCents(bill.amountCents)} from checking.`;
        } else {
          const unpaid = unpayBill(next, bill, stamp);
          next.checkingCents = unpaid.checkingCents;
          next.checkingUpdatedAt = unpaid.checkingUpdatedAt;
          next.expenses = unpaid.expenses;
          next.bills = unpaid.bills;
          note = bill.paidExpenseId
            ? `Marked ${bill.name} unpaid. Added the amount back to checking.`
            : `Marked ${bill.name} unpaid.`;
        }
      } else {
        note = bill ? `${bill.name} was already ${intent.paid ? "paid" : "unpaid"}.` : "No matching bill.";
      }
    } else if (intent.type === "set-from-check") {
      next.bills = stampBill(next.bills, intent.billId, stamp, {
        fromThisCheck: intent.fromThisCheck,
      });
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
        createdAt: stamp,
        autoCategorized: !intent.categoryId,
      };
      next.checkingCents -= intent.cents;
      next.checkingUpdatedAt = stamp;
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
