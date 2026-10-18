import { endOfMonth, formatAsOf, monthKey, startOfMonth, todayISO } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import type { AppState, Category, CategoryId, ChatProposal, Expense } from "@/lib/types";
import { EDIT_TOOL_DEFINITIONS, EDIT_TOOL_NAMES, executeEditTool } from "./proposals";

/**
 * Read-only lookups over an already loaded ledger.
 * These functions must not write the store, call mutating actions, or HTTP the app.
 * Live dollars stay in the tool result, never in the tool definitions (those are cached).
 */

export const READ_TOOL_NAMES = [
  "get_envelopes",
  "get_monthly_category_spend",
  "get_transactions",
  "get_bills",
  "get_checking_balance",
] as const;

export type ReadToolName = (typeof READ_TOOL_NAMES)[number];

export const DEFAULT_TRANSACTION_LIMIT = 25;
export const MAX_TRANSACTION_LIMIT = 40;

const CATEGORY_IDS: readonly CategoryId[] = [
  "rent",
  "gas",
  "groceries",
  "dining",
  "weekends",
  "utilities",
  "travel",
  "misc",
];

const CATEGORY_ALIASES: Record<string, CategoryId> = {
  restaurant: "dining",
  restaurants: "dining",
  "restaurant / dining": "dining",
  "dining out": "dining",
  grocery: "groceries",
  weekend: "weekends",
  electricity: "utilities",
  electric: "utilities",
  miscellaneous: "misc",
};

export type ToolOutcome =
  | { ok: true; data: unknown; proposal?: ChatProposal }
  | { ok: false; error: string };

export type AssistantTool = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    additionalProperties: false;
  };
  cache_control?: { type: "ephemeral" };
};

const monthProperty = {
  type: "string",
  description: "Calendar month as YYYY-MM in America/Chicago. Omit for the current month.",
};

const categoryProperty = {
  type: "string",
  description:
    "Envelope id: rent, gas, groceries, dining, weekends, utilities, travel, or misc. A name such as \"Restaurant / dining\" also works. Omit for every envelope.",
};

const TOOL_DEFINITIONS: readonly AssistantTool[] = [
  {
    name: "get_envelopes",
    description:
      "Read monthly envelope budgets. Each row is the budget, the amount spent in that month, and what is left (budget minus spent, which can be negative). Use this for \"how much is left\" questions. Read-only.",
    input_schema: {
      type: "object",
      properties: { month: monthProperty, category: categoryProperty },
      additionalProperties: false,
    },
  },
  {
    name: "get_monthly_category_spend",
    description:
      "Read how much was spent in each envelope for one month, plus the month total. This is logged expenses dated in that month, not the budget and not bill due amounts. Read-only.",
    input_schema: {
      type: "object",
      properties: { month: monthProperty, category: categoryProperty },
      additionalProperties: false,
    },
  },
  {
    name: "get_transactions",
    description:
      "Read logged charges (merchant, amount, category, date). Filter by month (YYYY-MM), category, merchant text (case-insensitive substring of the merchant), and an inclusive date range (from / to as YYYY-MM-DD). Newest first. Default limit 25, maximum 40. Read-only.",
    input_schema: {
      type: "object",
      properties: {
        month: monthProperty,
        category: categoryProperty,
        merchant: {
          type: "string",
          description: "Case-insensitive substring matched against the merchant name.",
        },
        from: {
          type: "string",
          description: "Inclusive start date, YYYY-MM-DD.",
        },
        to: {
          type: "string",
          description: "Inclusive end date, YYYY-MM-DD.",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_TRANSACTION_LIMIT,
          description: `How many charges to return. Default ${DEFAULT_TRANSACTION_LIMIT}, maximum ${MAX_TRANSACTION_LIMIT}.`,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_bills",
    description:
      "Read dated bills: name, amount, due date, paid flag, and whether the bill comes from this paycheck or the next. Read-only. This does not mark a bill paid.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "get_checking_balance",
    description:
      "Read the checking balance and the America/Chicago as-of stamp of the last edit. Read-only. This does not change checking.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
];

/** Stable tool list. Read tools stay first. The last definition carries the prompt-cache breakpoint. */
export function cachedAssistantTools(): AssistantTool[] {
  const tools: AssistantTool[] = [...TOOL_DEFINITIONS, ...EDIT_TOOL_DEFINITIONS];
  return tools.map((tool, index) =>
    index === tools.length - 1 ? { ...tool, cache_control: { type: "ephemeral" } } : { ...tool }
  );
}

export function executeAssistantTool(
  state: AppState,
  name: string,
  input: unknown,
  now = new Date()
): ToolOutcome {
  if ((READ_TOOL_NAMES as readonly string[]).includes(name)) {
    return executeReadTool(state, name, input, now);
  }
  if ((EDIT_TOOL_NAMES as readonly string[]).includes(name)) {
    return executeEditTool(state, name, input, now);
  }
  return { ok: false, error: "That tool is not available. Reads only." };
}

export function executeReadTool(
  state: AppState,
  name: string,
  input: unknown,
  now = new Date()
): ToolOutcome {
  const tool = TOOL_DEFINITIONS.find((entry) => entry.name === name);
  if (!tool) return { ok: false, error: "That tool is not available. Reads only." };
  const parsed = asRecord(input);
  if (!parsed.ok) return parsed;
  const record = parsed.record;

  switch (tool.name) {
    case "get_envelopes":
      return getEnvelopes(state, record, now);
    case "get_monthly_category_spend":
      return getMonthlyCategorySpend(state, record, now);
    case "get_transactions":
      return getTransactions(state, record);
    case "get_bills":
      return { ok: true, data: billsPayload(state) };
    case "get_checking_balance":
      return { ok: true, data: checkingPayload(state) };
    default:
      return { ok: false, error: "That tool is not available. Reads only." };
  }
}

function getEnvelopes(state: AppState, input: Record<string, unknown>, now: Date): ToolOutcome {
  const month = readRequiredMonth(input, now);
  if ("error" in month) return month;
  const category = readCategory(state, input);
  if ("error" in category) return category;
  const bounds = monthBounds(month.month);
  const categories = category.category ? [category.category] : orderedCategories(state);
  return {
    ok: true,
    data: {
      month: month.month,
      envelopes: categories.map((entry) => {
        const spentCents = spentBetween(state.expenses, bounds.from, bounds.to, entry.id);
        const remainingCents = entry.monthlyBudgetCents - spentCents;
        return {
          id: entry.id,
          name: entry.name,
          kind: entry.kind,
          budgetCents: entry.monthlyBudgetCents,
          budget: formatCents(entry.monthlyBudgetCents),
          spentCents,
          spent: formatCents(spentCents),
          remainingCents,
          remaining: formatCents(remainingCents),
        };
      }),
    },
  };
}

function getMonthlyCategorySpend(
  state: AppState,
  input: Record<string, unknown>,
  now: Date
): ToolOutcome {
  const month = readRequiredMonth(input, now);
  if ("error" in month) return month;
  const category = readCategory(state, input);
  if ("error" in category) return category;
  const bounds = monthBounds(month.month);
  const categories = category.category ? [category.category] : orderedCategories(state);
  const rows = categories.map((entry) => {
    const spentCents = spentBetween(state.expenses, bounds.from, bounds.to, entry.id);
    return {
      id: entry.id,
      name: entry.name,
      spentCents,
      spent: formatCents(spentCents),
    };
  });
  const totalSpentCents = rows.reduce((sum, row) => sum + row.spentCents, 0);
  return {
    ok: true,
    data: {
      month: month.month,
      totalSpentCents,
      totalSpent: formatCents(totalSpentCents),
      categories: rows,
    },
  };
}

function getTransactions(state: AppState, input: Record<string, unknown>): ToolOutcome {
  const month = readOptionalMonth(input);
  if ("error" in month) return month;
  const category = readCategory(state, input);
  if ("error" in category) return category;
  const merchant = readOptionalString(input, "merchant");
  if (typeof merchant !== "string" && merchant !== undefined) return merchant;
  const from = readOptionalDate(input, "from");
  if (typeof from !== "string" && from !== undefined) return from;
  const to = readOptionalDate(input, "to");
  if (typeof to !== "string" && to !== undefined) return to;
  if (from && to && from > to) return { ok: false, error: "The start date is after the end date." };
  const limit = readLimit(input.limit);
  if (typeof limit !== "number") return limit;

  let rangeFrom = from;
  let rangeTo = to;
  if (month.month) {
    const bounds = monthBounds(month.month);
    rangeFrom = rangeFrom && rangeFrom > bounds.from ? rangeFrom : bounds.from;
    rangeTo = rangeTo && rangeTo < bounds.to ? rangeTo : bounds.to;
  }

  const needle = merchant?.toLowerCase();
  const matched = state.expenses.filter((expense) => {
    if (category.category && expense.categoryId !== category.category.id) return false;
    if (rangeFrom && expense.date < rangeFrom) return false;
    if (rangeTo && expense.date > rangeTo) return false;
    if (needle && !expense.merchant.toLowerCase().includes(needle)) return false;
    return true;
  });
  matched.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });

  const page = matched.slice(0, limit);
  const names = new Map(state.categories.map((entry) => [entry.id, entry.name]));
  return {
    ok: true,
    data: {
      month: month.month ?? null,
      category: category.category?.id ?? null,
      merchant: merchant ?? null,
      from: from ?? null,
      to: to ?? null,
      matchCount: matched.length,
      returned: page.length,
      limit,
      truncated: matched.length > page.length,
      transactions: page.map((expense) => ({
        id: expense.id,
        date: expense.date,
        merchant: expense.merchant,
        note: expense.note,
        categoryId: expense.categoryId,
        categoryName: names.get(expense.categoryId) ?? expense.categoryId,
        amountCents: expense.amountCents,
        amount: formatCents(expense.amountCents),
        source: expense.source,
      })),
    },
  };
}

function billsPayload(state: AppState) {
  const bills = [...state.bills].sort((a, b) => {
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return {
    bills: bills.map((bill) => ({
      id: bill.id,
      name: bill.name,
      amountCents: bill.amountCents,
      amount: formatCents(bill.amountCents),
      dueDate: bill.dueDate,
      paid: bill.paid,
      kind: bill.kind,
      fromThisCheck: bill.fromThisCheck,
      paycheck: bill.fromThisCheck ? "this paycheck" : "next paycheck",
      updatedAt: bill.updatedAt ?? null,
      asOf: formatAsOf(bill.updatedAt),
    })),
  };
}

function checkingPayload(state: AppState) {
  const checkingCents = Number.isFinite(state.checkingCents) ? state.checkingCents : 0;
  return {
    checkingCents,
    checking: formatCents(checkingCents),
    updatedAt: state.checkingUpdatedAt ?? null,
    asOf: formatAsOf(state.checkingUpdatedAt),
  };
}

function orderedCategories(state: AppState): Category[] {
  return [...state.categories].sort((a, b) => a.sortOrder - b.sortOrder);
}

function spentBetween(expenses: Expense[], from: string, to: string, categoryId: CategoryId): number {
  return expenses.reduce((sum, expense) => {
    if (expense.categoryId !== categoryId) return sum;
    if (expense.date < from || expense.date > to) return sum;
    return sum + expense.amountCents;
  }, 0);
}

function monthBounds(month: string): { from: string; to: string } {
  const anchor = `${month}-01`;
  return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
}

function asRecord(
  input: unknown
): { ok: true; record: Record<string, unknown> } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, record: {} };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Tool input must be an object." };
  }
  return { ok: true, record: input as Record<string, unknown> };
}

function readRequiredMonth(
  input: Record<string, unknown>,
  now: Date
): { month: string } | { ok: false; error: string } {
  const parsed = parseMonth(input);
  if ("error" in parsed) return parsed;
  return { month: parsed.month ?? monthKey(todayISO(now)) };
}

function readOptionalMonth(
  input: Record<string, unknown>
): { month: string | null } | { ok: false; error: string } {
  const parsed = parseMonth(input);
  if ("error" in parsed) return parsed;
  return { month: parsed.month };
}

function parseMonth(
  input: Record<string, unknown>
): { month: string | null } | { ok: false; error: string } {
  const value = readOptionalString(input, "month");
  if (value && typeof value !== "string") return value;
  if (!value) return { month: null };
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    return { ok: false, error: "month must be YYYY-MM." };
  }
  return { month: value };
}

function readCategory(
  state: AppState,
  input: Record<string, unknown>
): { category: Category | null } | { ok: false; error: string } {
  const value = readOptionalString(input, "category");
  if (value && typeof value !== "string") return value;
  if (!value) return { category: null };
  const key = value.toLowerCase();
  const byId = state.categories.find((entry) => entry.id === key);
  if (byId) return { category: byId };
  const byName = state.categories.find((entry) => entry.name.toLowerCase() === key);
  if (byName) return { category: byName };
  const alias = CATEGORY_ALIASES[key];
  if (alias) {
    const found = state.categories.find((entry) => entry.id === alias);
    if (found) return { category: found };
  }
  return {
    ok: false,
    error: `Unknown category "${value}". Use ${CATEGORY_IDS.join(", ")}.`,
  };
}

function readOptionalString(
  input: Record<string, unknown>,
  key: string
): string | undefined | { ok: false; error: string } {
  if (!(key in input) || input[key] === undefined || input[key] === null || input[key] === "") {
    return undefined;
  }
  if (typeof input[key] !== "string") return { ok: false, error: `${key} must be a string.` };
  const trimmed = input[key].trim();
  return trimmed || undefined;
}

function readOptionalDate(
  input: Record<string, unknown>,
  key: string
): string | undefined | { ok: false; error: string } {
  const value = readOptionalString(input, key);
  if (value === undefined || typeof value !== "string") return value;
  if (!isIsoDate(value)) return { ok: false, error: `${key} must be YYYY-MM-DD.` };
  return value;
}

function readLimit(value: unknown): number | { ok: false; error: string } {
  if (value === undefined || value === null) return DEFAULT_TRANSACTION_LIMIT;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return { ok: false, error: "limit must be a positive integer." };
  }
  return Math.min(value, MAX_TRANSACTION_LIMIT);
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
