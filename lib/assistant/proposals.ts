import { nanoid } from "nanoid";
import { rememberMerchant, suggestCategory } from "@/lib/categorize";
import { todayISO } from "@/lib/dates";
import { dollarsToCents, formatCents } from "@/lib/money";
import type {
  AppState,
  AssistantAuditEntry,
  CategoryId,
  ChatProposal,
  Expense,
  ExpenseSource,
  ProposalChange,
  ProposalScalar,
  UpcomingBill,
} from "@/lib/types";

/**
 * Edit tools build a confirm-card proposal from the ledger snapshot.
 * They do not import the store and they do not write.
 * Apply and undo live in apply-edit.ts and run only after a confirm.
 */

export const EDIT_TOOL_NAMES = [
  "propose_envelope_amount",
  "propose_bill_amount",
  "propose_bill_due_date",
  "propose_bill_paid",
  "propose_checking_balance",
  "propose_log_expense",
  "propose_recategorize_expense",
  "propose_delete_expense",
] as const;

export type EditToolName = (typeof EDIT_TOOL_NAMES)[number];

export const STALE_EDIT_MESSAGE =
  "That value changed since this was proposed. Ask again and I'll make a fresh card.";

const CREATED = "$created";
const MAX_CENTS = 1_000_000_000;

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

const HIDDEN_FIELDS = new Set(["paidExpenseId", "createdAt", "autoCategorized", "source", "exists"]);

const EXPENSE_FIELDS = new Set([
  "exists",
  "amountCents",
  "merchant",
  "categoryId",
  "date",
  "note",
  "source",
  "autoCategorized",
  "createdAt",
]);

export type ToolDefinition = {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    additionalProperties: false;
  };
};

export type ProposalOutcome =
  | { ok: true; data: unknown; proposal: ChatProposal }
  | { ok: false; error: string };

export type CommitResult = {
  state: AppState;
  ok: boolean;
  code?: "missing" | "closed" | "stale" | "bad";
  error?: string;
  auditId?: string;
};

export type IdFactory = {
  auditId: () => string;
  expenseId: () => string;
};

const amountProperty = {
  type: "number",
  description: "Dollar amount, such as 10 or 12.34. Not cents.",
};

const categoryProperty = {
  type: "string",
  description:
    "Envelope id: rent, gas, groceries, dining, weekends, utilities, travel, or misc. A name such as \"Restaurant / dining\" also works.",
};

const billProperty = {
  type: "string",
  description: "Bill id or name, such as amex, Apple Card, bofa, or rent.",
};

export const EDIT_TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: "propose_envelope_amount",
    description:
      "Propose a new monthly budget for one envelope. This does not log a purchase and does not move checking. A message like \"$10 for restaurant\" is a purchase: use propose_log_expense instead. Nothing is saved until Arjun confirms the card.",
    input_schema: {
      type: "object",
      properties: { category: categoryProperty, amount: amountProperty },
      additionalProperties: false,
    },
  },
  {
    name: "propose_bill_amount",
    description:
      "Propose a new amount for one dated bill. Does not change checking and does not log a payment. Nothing is saved until Arjun confirms the card.",
    input_schema: {
      type: "object",
      properties: { bill: billProperty, amount: amountProperty },
      additionalProperties: false,
    },
  },
  {
    name: "propose_bill_due_date",
    description:
      "Propose a new due date (YYYY-MM-DD) for one dated bill. Does not mark it paid and does not move checking. Nothing is saved until Arjun confirms the card.",
    input_schema: {
      type: "object",
      properties: {
        bill: billProperty,
        dueDate: { type: "string", description: "Due date as YYYY-MM-DD." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "propose_bill_paid",
    description:
      "Propose marking one dated bill paid or unpaid. Paying also proposes the checking deduction and the payment charge. Nothing is saved until Arjun confirms the card.",
    input_schema: {
      type: "object",
      properties: {
        bill: billProperty,
        paid: { type: "boolean", description: "True to mark paid, false to mark unpaid." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "propose_checking_balance",
    description:
      "Propose a new checking balance. This sets the balance he states. It does not add a paycheck on top and it does not invent a balance. Nothing is saved until Arjun confirms the card.",
    input_schema: {
      type: "object",
      properties: { amount: amountProperty },
      additionalProperties: false,
    },
  },
  {
    name: "propose_log_expense",
    description:
      "Propose logging one purchase. This subtracts the amount from checking and files it under an envelope. It does not change that envelope's monthly budget. \"$10 for restaurant\" is this tool, not propose_envelope_amount. Ask if the merchant or envelope is ambiguous. Nothing is saved until Arjun confirms the card.",
    input_schema: {
      type: "object",
      properties: {
        amount: amountProperty,
        merchant: { type: "string", description: "Merchant or place, such as Restaurant or Chipotle." },
        category: { ...categoryProperty, description: `${categoryProperty.description} Omit only if you are not sure; the card will show the guess.` },
        date: { type: "string", description: "Purchase date as YYYY-MM-DD. Omit for today in America/Chicago. Not in the future." },
        note: { type: "string", description: "Optional note." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "propose_recategorize_expense",
    description:
      "Propose moving one logged charge to a different envelope. Pass expenseId when you have it. If several charges match the merchant, this returns an error so you can ask which one. Does not change the envelope budget or checking. Nothing is saved until Arjun confirms the card.",
    input_schema: {
      type: "object",
      properties: {
        expenseId: { type: "string", description: "Charge id from get_transactions." },
        merchant: { type: "string", description: "Merchant text, used when expenseId is omitted." },
        date: { type: "string", description: "YYYY-MM-DD, to narrow a merchant match." },
        category: categoryProperty,
      },
      additionalProperties: false,
    },
  },
  {
    name: "propose_delete_expense",
    description:
      "Propose deleting one logged charge and adding its amount back to checking. Pass expenseId when you have it. If several charges match, this returns an error so you can ask which one. Nothing is saved until Arjun confirms the card.",
    input_schema: {
      type: "object",
      properties: {
        expenseId: { type: "string", description: "Charge id from get_transactions." },
        merchant: { type: "string", description: "Merchant text, used when expenseId is omitted." },
        date: { type: "string", description: "YYYY-MM-DD, to narrow a merchant match." },
      },
      additionalProperties: false,
    },
  },
];

export function executeEditTool(
  state: AppState,
  name: string,
  input: unknown,
  now = new Date(),
  nextId: () => string = () => nanoid()
): ProposalOutcome | { ok: false; error: string } {
  const tool = EDIT_TOOL_DEFINITIONS.find((entry) => entry.name === name);
  if (!tool) return { ok: false, error: "That tool is not available. Reads only." };
  const parsed = asRecord(input);
  if (!parsed.ok) return parsed;
  const record = parsed.record;

  switch (tool.name) {
    case "propose_envelope_amount":
      return proposeEnvelope(state, record, nextId);
    case "propose_bill_amount":
      return proposeBillAmount(state, record, nextId);
    case "propose_bill_due_date":
      return proposeBillDue(state, record, nextId);
    case "propose_bill_paid":
      return proposeBillPaid(state, record, now, nextId);
    case "propose_checking_balance":
      return proposeChecking(state, record, nextId);
    case "propose_log_expense":
      return proposeLog(state, record, now, nextId);
    case "propose_recategorize_expense":
      return proposeRecategorize(state, record, nextId);
    case "propose_delete_expense":
      return proposeDelete(state, record, nextId);
    default:
      return { ok: false, error: "That tool is not available. Reads only." };
  }
}

export function commitProposal(
  state: AppState,
  proposalId: string,
  now = new Date(),
  ids?: IdFactory
): CommitResult {
  const proposal = findProposal(state, proposalId);
  if (!proposal) {
    return { state, ok: false, code: "missing", error: "That card is no longer here. Ask again." };
  }
  if (proposal.status !== "pending") {
    return { state, ok: false, code: "closed", error: closedMessage(proposal.status) };
  }
  for (const change of proposal.changes) {
    const current = readField(state, change.entity, change.field);
    if (current === undefined || current !== change.oldValue) {
      return {
        state: withProposal(state, proposalId, { status: "stale" }),
        ok: false,
        code: "stale",
        error: STALE_EDIT_MESSAGE,
      };
    }
  }
  const factory = ids ?? defaultIds();
  const resolved = resolveChanges(proposal.changes, factory.expenseId);
  if (!resolved) {
    return { state, ok: false, code: "bad", error: "That card cannot be applied." };
  }
  let draft = state;
  for (const change of sortChanges(resolved)) {
    draft = writeField(draft, change, now);
  }
  if (proposal.tool === "propose_log_expense" || proposal.tool === "propose_recategorize_expense") {
    draft = rememberFromChanges(draft, resolved, "new");
  }
  const audit: AssistantAuditEntry = {
    id: factory.auditId(),
    at: now.toISOString(),
    tool: proposal.tool,
    summary: proposal.summary,
    before: resolved.map((change) => ({ entity: change.entity, field: change.field, value: change.oldValue })),
    after: resolved.map((change) => ({ entity: change.entity, field: change.field, value: change.newValue })),
    source: "assistant",
  };
  draft = {
    ...draft,
    assistantAudit: [...(draft.assistantAudit ?? []), audit],
  };
  draft = withProposal(draft, proposalId, { status: "applied", auditId: audit.id });
  return { state: draft, ok: true, auditId: audit.id };
}

export function commitCancel(state: AppState, proposalId: string): CommitResult {
  const proposal = findProposal(state, proposalId);
  if (!proposal) {
    return { state, ok: false, code: "missing", error: "That card is no longer here. Ask again." };
  }
  if (proposal.status !== "pending") {
    return { state, ok: false, code: "closed", error: closedMessage(proposal.status) };
  }
  return { state: withProposal(state, proposalId, { status: "cancelled" }), ok: true };
}

export function commitUndo(state: AppState, auditId: string | undefined, now = new Date()): CommitResult {
  const audit = state.assistantAudit ?? [];
  const entry = auditId ? audit.find((row) => row.id === auditId) : audit[audit.length - 1];
  if (!entry) {
    return {
      state,
      ok: false,
      code: "missing",
      error: auditId ? "That edit is not in the audit log." : "There is no assistant edit to undo.",
    };
  }
  if (entry.undoneAt) {
    return { state, ok: false, code: "closed", error: "That edit was already undone." };
  }
  if (entry.source !== "assistant" || entry.before.length !== entry.after.length || entry.before.length === 0) {
    return { state, ok: false, code: "bad", error: "That edit cannot be undone." };
  }
  for (let index = 0; index < entry.after.length; index++) {
    const after = entry.after[index];
    const before = entry.before[index];
    if (!after || !before || after.entity !== before.entity || after.field !== before.field) {
      return { state, ok: false, code: "bad", error: "That edit cannot be undone." };
    }
    const current = readField(state, after.entity, after.field);
    if (current === undefined || current !== after.value) {
      return { state, ok: false, code: "stale", error: STALE_EDIT_MESSAGE };
    }
  }
  const inverse: ProposalChange[] = entry.after.map((after, index) => ({
    entity: after.entity,
    entityLabel: after.entity,
    field: after.field,
    fieldLabel: after.field,
    oldValue: after.value,
    newValue: entry.before[index]!.value,
    oldLabel: "",
    newLabel: "",
  }));
  let draft = state;
  for (const change of sortChanges(inverse)) {
    draft = writeField(draft, change, now);
  }
  if (entry.tool === "propose_recategorize_expense" || entry.tool === "propose_log_expense") {
    draft = rememberFromValues(draft, entry.tool === "propose_log_expense" ? entry.after : entry.before);
  }
  draft = {
    ...draft,
    assistantAudit: (draft.assistantAudit ?? []).map((row) =>
      row.id === entry.id ? { ...row, undoneAt: now.toISOString() } : row
    ),
  };
  draft = markByAudit(draft, entry.id, "undone");
  return { state: draft, ok: true, auditId: entry.id };
}

function proposeEnvelope(
  state: AppState,
  input: Record<string, unknown>,
  nextId: () => string
): ProposalOutcome | { ok: false; error: string } {
  const category = mustCategory(state, input);
  if ("error" in category) return category;
  const amount = readMoney(input, "amount");
  if (typeof amount !== "number") return amount;
  if (amount < 0) return { ok: false, error: "An envelope budget cannot be negative." };
  const current = category.category.monthlyBudgetCents;
  if (current === amount) {
    return { ok: false, error: `${category.category.name} is already ${formatCents(amount)} a month.` };
  }
  const card = makeProposal(
    "propose_envelope_amount",
    `Set ${category.category.name} monthly budget from ${formatCents(current)} to ${formatCents(amount)}.`,
    [
      diff({
        entity: `envelope:${category.category.id}`,
        entityLabel: category.category.name,
        field: "monthlyBudgetCents",
        fieldLabel: "Monthly budget",
        oldValue: current,
        newValue: amount,
        oldLabel: formatCents(current),
        newLabel: formatCents(amount),
      }),
    ],
    nextId
  );
  return proposed(card);
}

function proposeBillAmount(
  state: AppState,
  input: Record<string, unknown>,
  nextId: () => string
): ProposalOutcome | { ok: false; error: string } {
  const bill = readBill(state, input);
  if ("error" in bill) return bill;
  const amount = readMoney(input, "amount");
  if (typeof amount !== "number") return amount;
  if (amount < 0) return { ok: false, error: "A bill amount cannot be negative." };
  if (bill.bill.amountCents === amount) {
    return { ok: false, error: `${bill.bill.name} is already ${formatCents(amount)}.` };
  }
  return proposed(
    makeProposal(
      "propose_bill_amount",
      `Set ${bill.bill.name} from ${formatCents(bill.bill.amountCents)} to ${formatCents(amount)}.`,
      [
        diff({
          entity: `bill:${bill.bill.id}`,
          entityLabel: bill.bill.name,
          field: "amountCents",
          fieldLabel: "Amount",
          oldValue: bill.bill.amountCents,
          newValue: amount,
          oldLabel: formatCents(bill.bill.amountCents),
          newLabel: formatCents(amount),
        }),
      ],
      nextId
    )
  );
}

function proposeBillDue(
  state: AppState,
  input: Record<string, unknown>,
  nextId: () => string
): ProposalOutcome | { ok: false; error: string } {
  const bill = readBill(state, input);
  if ("error" in bill) return bill;
  const due = readDate(input, "dueDate", true);
  if (typeof due !== "string") return due ?? { ok: false, error: "dueDate must be YYYY-MM-DD." };
  if (bill.bill.dueDate === due) {
    return { ok: false, error: `${bill.bill.name} is already due ${due}.` };
  }
  return proposed(
    makeProposal(
      "propose_bill_due_date",
      `Set ${bill.bill.name} due date from ${bill.bill.dueDate} to ${due}.`,
      [
        diff({
          entity: `bill:${bill.bill.id}`,
          entityLabel: bill.bill.name,
          field: "dueDate",
          fieldLabel: "Due date",
          oldValue: bill.bill.dueDate,
          newValue: due,
          oldLabel: bill.bill.dueDate,
          newLabel: due,
        }),
      ],
      nextId
    )
  );
}

function proposeBillPaid(
  state: AppState,
  input: Record<string, unknown>,
  now: Date,
  nextId: () => string
): ProposalOutcome | { ok: false; error: string } {
  const bill = readBill(state, input);
  if ("error" in bill) return bill;
  if (typeof input.paid !== "boolean") return { ok: false, error: "paid must be true or false." };
  const paid = input.paid;
  if (bill.bill.paid === paid) {
    return { ok: false, error: `${bill.bill.name} is already ${paid ? "paid" : "unpaid"}.` };
  }
  const changes = paid ? payChanges(state, bill.bill, now) : unpayChanges(state, bill.bill);
  return proposed(
    makeProposal(
      "propose_bill_paid",
      `Mark ${bill.bill.name} ${paid ? "paid" : "unpaid"}.`,
      changes,
      nextId
    )
  );
}

function proposeChecking(
  state: AppState,
  input: Record<string, unknown>,
  nextId: () => string
): ProposalOutcome | { ok: false; error: string } {
  const amount = readMoney(input, "amount");
  if (typeof amount !== "number") return amount;
  const current = Number.isFinite(state.checkingCents) ? state.checkingCents : 0;
  if (current === amount) return { ok: false, error: `Checking is already ${formatCents(amount)}.` };
  return proposed(
    makeProposal(
      "propose_checking_balance",
      `Set checking from ${formatCents(current)} to ${formatCents(amount)}.`,
      [checkingDiff(current, amount)],
      nextId
    )
  );
}

function proposeLog(
  state: AppState,
  input: Record<string, unknown>,
  now: Date,
  nextId: () => string
): ProposalOutcome | { ok: false; error: string } {
  const amount = readMoney(input, "amount");
  if (typeof amount !== "number") return amount;
  if (amount <= 0) return { ok: false, error: "A purchase has to be more than zero." };
  const merchant = readString(input, "merchant");
  if (merchant && typeof merchant !== "string") return merchant;
  if (!merchant) return { ok: false, error: "Name the merchant, such as Restaurant." };
  const explicit = readCategory(state, input, false);
  if ("error" in explicit) return explicit;
  const inferred = explicit.category
    ? { id: explicit.category.id, explicit: true }
    : { id: suggestCategory(merchant, state.merchantRules).categoryId, explicit: false };
  const date = readDate(input, "date", false);
  if (typeof date !== "string" && date !== undefined) return date;
  const today = todayISO(now);
  const when = date ?? today;
  if (when > today) return { ok: false, error: "A purchase date cannot be in the future." };
  const noteValue = readString(input, "note");
  if (noteValue && typeof noteValue !== "string") return noteValue;
  const note = noteValue ?? "";
  const checking = Number.isFinite(state.checkingCents) ? state.checkingCents : 0;
  const name = categoryName(state, inferred.id);
  return proposed(
    makeProposal(
      "propose_log_expense",
      `Log ${formatCents(amount)} at ${merchant} in ${name}.`,
      [
        ...expenseCreateChanges({
          amountCents: amount,
          merchant,
          categoryId: inferred.id,
          categoryLabel: name,
          date: when,
          note,
          source: "manual",
          autoCategorized: !inferred.explicit,
        }),
        checkingDiff(checking, checking - amount),
      ],
      nextId
    )
  );
}

function proposeRecategorize(
  state: AppState,
  input: Record<string, unknown>,
  nextId: () => string
): ProposalOutcome | { ok: false; error: string } {
  const found = findExpense(state, input);
  if ("error" in found) return found;
  const category = mustCategory(state, input);
  if ("error" in category) return category;
  const expense = found.expense;
  if (expense.categoryId === category.category.id && expense.autoCategorized === false) {
    return { ok: false, error: `${expense.merchant} is already in ${category.category.name}.` };
  }
  const from = categoryName(state, expense.categoryId);
  const changes: ProposalChange[] = [
    diff({
      entity: `expense:${expense.id}`,
      entityLabel: expense.merchant,
      field: "categoryId",
      fieldLabel: "Category",
      oldValue: expense.categoryId,
      newValue: category.category.id,
      oldLabel: from,
      newLabel: category.category.name,
    }),
    identityExpense(expense, "merchant", "Merchant", expense.merchant, expense.merchant),
    identityExpense(expense, "amountCents", "Amount", expense.amountCents, formatCents(expense.amountCents)),
    identityExpense(expense, "date", "Date", expense.date, expense.date),
  ];
  if (expense.autoCategorized) {
    changes.push(
      diff({
        entity: `expense:${expense.id}`,
        entityLabel: expense.merchant,
        field: "autoCategorized",
        fieldLabel: "Auto",
        oldValue: true,
        newValue: false,
        oldLabel: "Auto",
        newLabel: "Chosen",
      })
    );
  }
  return proposed(
    makeProposal(
      "propose_recategorize_expense",
      `Move ${expense.merchant} from ${from} to ${category.category.name}.`,
      changes,
      nextId
    )
  );
}

function proposeDelete(
  state: AppState,
  input: Record<string, unknown>,
  nextId: () => string
): ProposalOutcome | { ok: false; error: string } {
  const found = findExpense(state, input);
  if ("error" in found) return found;
  const expense = found.expense;
  const checking = Number.isFinite(state.checkingCents) ? state.checkingCents : 0;
  return proposed(
    makeProposal(
      "propose_delete_expense",
      `Delete ${expense.merchant} ${formatCents(expense.amountCents)} on ${expense.date}.`,
      [
        ...expenseClearChanges(expense, categoryName(state, expense.categoryId)),
        checkingDiff(checking, checking + expense.amountCents),
      ],
      nextId
    )
  );
}

function payChanges(state: AppState, bill: UpcomingBill, now: Date): ProposalChange[] {
  const checking = Number.isFinite(state.checkingCents) ? state.checkingCents : 0;
  const categoryId: CategoryId = bill.kind === "rent" ? "rent" : "misc";
  return [
    diff({
      entity: `bill:${bill.id}`,
      entityLabel: bill.name,
      field: "paid",
      fieldLabel: "Paid",
      oldValue: false,
      newValue: true,
      oldLabel: "Unpaid",
      newLabel: "Paid",
    }),
    diff({
      entity: `bill:${bill.id}`,
      entityLabel: bill.name,
      field: "paidExpenseId",
      fieldLabel: "Payment",
      oldValue: bill.paidExpenseId ?? null,
      newValue: CREATED,
      oldLabel: "—",
      newLabel: "New payment",
    }),
    ...expenseCreateChanges({
      amountCents: bill.amountCents,
      merchant: bill.name,
      categoryId,
      categoryLabel: categoryName(state, categoryId),
      date: todayISO(now),
      note: `Paid · due ${bill.dueDate}`,
      source: "bill",
      autoCategorized: false,
    }),
    checkingDiff(checking, checking - bill.amountCents),
  ];
}

function unpayChanges(state: AppState, bill: UpcomingBill): ProposalChange[] {
  const linked = bill.paidExpenseId ? state.expenses.find((expense) => expense.id === bill.paidExpenseId) : undefined;
  const refund = bill.paidExpenseId ? (linked?.amountCents ?? bill.amountCents) : 0;
  const checking = Number.isFinite(state.checkingCents) ? state.checkingCents : 0;
  const changes: ProposalChange[] = [
    diff({
      entity: `bill:${bill.id}`,
      entityLabel: bill.name,
      field: "paid",
      fieldLabel: "Paid",
      oldValue: true,
      newValue: false,
      oldLabel: "Paid",
      newLabel: "Unpaid",
    }),
  ];
  if (bill.paidExpenseId) {
    changes.push(
      diff({
        entity: `bill:${bill.id}`,
        entityLabel: bill.name,
        field: "paidExpenseId",
        fieldLabel: "Payment",
        oldValue: bill.paidExpenseId,
        newValue: null,
        oldLabel: bill.paidExpenseId,
        newLabel: "—",
      })
    );
    if (linked) changes.push(...expenseClearChanges(linked, categoryName(state, linked.categoryId)));
  }
  changes.push(checkingDiff(checking, checking + refund));
  return changes;
}

function expenseCreateChanges(input: {
  amountCents: number;
  merchant: string;
  categoryId: CategoryId;
  categoryLabel: string;
  date: string;
  note: string;
  source: ExpenseSource;
  autoCategorized: boolean;
}): ProposalChange[] {
  const entity = "expense:new";
  const entityLabel = input.merchant;
  return [
    diff({
      entity,
      entityLabel,
      field: "exists",
      fieldLabel: "Exists",
      oldValue: false,
      newValue: true,
      oldLabel: "No",
      newLabel: "Yes",
    }),
    diff({
      entity,
      entityLabel,
      field: "amountCents",
      fieldLabel: "Amount",
      oldValue: null,
      newValue: input.amountCents,
      oldLabel: "—",
      newLabel: formatCents(input.amountCents),
    }),
    diff({
      entity,
      entityLabel,
      field: "merchant",
      fieldLabel: "Merchant",
      oldValue: null,
      newValue: input.merchant,
      oldLabel: "—",
      newLabel: input.merchant,
    }),
    diff({
      entity,
      entityLabel,
      field: "categoryId",
      fieldLabel: "Category",
      oldValue: null,
      newValue: input.categoryId,
      oldLabel: "—",
      newLabel: input.categoryLabel,
    }),
    diff({
      entity,
      entityLabel,
      field: "date",
      fieldLabel: "Date",
      oldValue: null,
      newValue: input.date,
      oldLabel: "—",
      newLabel: input.date,
    }),
    diff({
      entity,
      entityLabel,
      field: "note",
      fieldLabel: "Note",
      oldValue: null,
      newValue: input.note,
      oldLabel: "—",
      newLabel: input.note || "—",
    }),
    diff({
      entity,
      entityLabel,
      field: "source",
      fieldLabel: "Source",
      oldValue: null,
      newValue: input.source,
      oldLabel: "—",
      newLabel: input.source,
    }),
    diff({
      entity,
      entityLabel,
      field: "autoCategorized",
      fieldLabel: "Auto",
      oldValue: null,
      newValue: input.autoCategorized,
      oldLabel: "—",
      newLabel: input.autoCategorized ? "Auto" : "Chosen",
    }),
  ];
}

function expenseClearChanges(expense: Expense, categoryLabel: string = expense.categoryId): ProposalChange[] {
  const entity = `expense:${expense.id}`;
  const entityLabel = expense.merchant;
  return [
    diff({
      entity,
      entityLabel,
      field: "exists",
      fieldLabel: "Exists",
      oldValue: true,
      newValue: false,
      oldLabel: "Yes",
      newLabel: "No",
    }),
    diff({
      entity,
      entityLabel,
      field: "amountCents",
      fieldLabel: "Amount",
      oldValue: expense.amountCents,
      newValue: null,
      oldLabel: formatCents(expense.amountCents),
      newLabel: "—",
    }),
    diff({
      entity,
      entityLabel,
      field: "merchant",
      fieldLabel: "Merchant",
      oldValue: expense.merchant,
      newValue: null,
      oldLabel: expense.merchant,
      newLabel: "—",
    }),
    diff({
      entity,
      entityLabel,
      field: "categoryId",
      fieldLabel: "Category",
      oldValue: expense.categoryId,
      newValue: null,
      oldLabel: categoryLabel,
      newLabel: "—",
    }),
    diff({
      entity,
      entityLabel,
      field: "date",
      fieldLabel: "Date",
      oldValue: expense.date,
      newValue: null,
      oldLabel: expense.date,
      newLabel: "—",
    }),
    diff({
      entity,
      entityLabel,
      field: "note",
      fieldLabel: "Note",
      oldValue: expense.note,
      newValue: null,
      oldLabel: expense.note || "—",
      newLabel: "—",
    }),
    diff({
      entity,
      entityLabel,
      field: "source",
      fieldLabel: "Source",
      oldValue: expense.source,
      newValue: null,
      oldLabel: expense.source,
      newLabel: "—",
    }),
    diff({
      entity,
      entityLabel,
      field: "autoCategorized",
      fieldLabel: "Auto",
      oldValue: expense.autoCategorized,
      newValue: null,
      oldLabel: expense.autoCategorized ? "Auto" : "Chosen",
      newLabel: "—",
    }),
    diff({
      entity,
      entityLabel,
      field: "createdAt",
      fieldLabel: "Created",
      oldValue: expense.createdAt,
      newValue: null,
      oldLabel: expense.createdAt,
      newLabel: "—",
    }),
  ];
}

function identityExpense(
  expense: Expense,
  field: string,
  fieldLabel: string,
  value: ProposalScalar,
  label: string
): ProposalChange {
  return diff({
    entity: `expense:${expense.id}`,
    entityLabel: expense.merchant,
    field,
    fieldLabel,
    oldValue: value,
    newValue: value,
    oldLabel: label,
    newLabel: label,
  });
}

function checkingDiff(oldCents: number, newCents: number): ProposalChange {
  return diff({
    entity: "checking",
    entityLabel: "Checking",
    field: "checkingCents",
    fieldLabel: "Balance",
    oldValue: oldCents,
    newValue: newCents,
    oldLabel: formatCents(oldCents),
    newLabel: formatCents(newCents),
  });
}

function diff(change: ProposalChange): ProposalChange {
  return change;
}

function makeProposal(
  tool: EditToolName,
  summary: string,
  changes: ProposalChange[],
  nextId: () => string
): ChatProposal {
  return {
    id: nextId(),
    tool,
    summary,
    status: "pending",
    changes,
  };
}

function proposed(proposal: ChatProposal): ProposalOutcome {
  return {
    ok: true,
    proposal,
    data: {
      proposed: true,
      saved: false,
      proposalId: proposal.id,
      summary: proposal.summary,
      changes: proposal.changes
        .filter((change) => !HIDDEN_FIELDS.has(change.field) && change.oldLabel !== change.newLabel)
        .map((change) => ({
          entity: change.entityLabel,
          field: change.fieldLabel,
          oldValue: change.oldLabel,
          newValue: change.newLabel,
        })),
      instruction:
        "Nothing was saved. A confirm card is on screen. Ask Arjun to confirm or cancel. Do not say the edit already happened.",
    },
  };
}

function defaultIds(): IdFactory {
  return { auditId: () => nanoid(), expenseId: () => nanoid() };
}

function closedMessage(status: ChatProposal["status"]): string {
  if (status === "applied") return "That card was already confirmed.";
  if (status === "cancelled") return "That card was cancelled.";
  if (status === "undone") return "That edit was already undone.";
  if (status === "stale") return STALE_EDIT_MESSAGE;
  return "That card cannot be applied.";
}

function findProposal(state: AppState, id: string): ChatProposal | undefined {
  for (const message of state.chatMessages) {
    const found = message.proposals?.find((proposal) => proposal.id === id);
    if (found) return found;
  }
  return undefined;
}

function withProposal(
  state: AppState,
  id: string,
  patch: Partial<Pick<ChatProposal, "status" | "auditId">>
): AppState {
  return {
    ...state,
    chatMessages: state.chatMessages.map((message) => {
      if (!message.proposals?.some((proposal) => proposal.id === id)) return message;
      return {
        ...message,
        proposals: message.proposals.map((proposal) =>
          proposal.id === id ? { ...proposal, ...patch } : proposal
        ),
      };
    }),
  };
}

function markByAudit(state: AppState, auditId: string, status: ChatProposal["status"]): AppState {
  return {
    ...state,
    chatMessages: state.chatMessages.map((message) => {
      if (!message.proposals?.some((proposal) => proposal.auditId === auditId)) return message;
      return {
        ...message,
        proposals: message.proposals.map((proposal) =>
          proposal.auditId === auditId ? { ...proposal, status } : proposal
        ),
      };
    }),
  };
}

function resolveChanges(changes: ProposalChange[], expenseId: () => string): ProposalChange[] | null {
  let created: string | null = null;
  const resolved = changes.map((change) => {
    let entity = change.entity;
    let newValue = change.newValue;
    if (entity === "expense:new") {
      created ??= expenseId();
      entity = `expense:${created}`;
    }
    if (newValue === CREATED) {
      created ??= expenseId();
      newValue = created;
    }
    return { ...change, entity, newValue };
  });
  if (resolved.some((change) => change.entity === "expense:new" || change.entity === "expense:" || change.newValue === CREATED)) {
    return null;
  }
  if (!created && resolved.some((change) => change.entity.startsWith("expense:") && change.field === "exists" && change.newValue === true && change.oldValue === false)) {
    return null;
  }
  return resolved;
}

function sortChanges(changes: ProposalChange[]): ProposalChange[] {
  return [...changes].sort((a, b) => rank(a) - rank(b));
}

function rank(change: ProposalChange): number {
  if (change.field === "exists" && change.newValue === true) return 0;
  if (change.field === "exists" && change.newValue === false) return 2;
  return 1;
}

function rememberFromChanges(state: AppState, changes: ProposalChange[], side: "new" | "old"): AppState {
  const merchant = changes.find((change) => change.field === "merchant" && change.entity.startsWith("expense:"));
  const category = changes.find((change) => change.field === "categoryId" && change.entity.startsWith("expense:"));
  const merchantValue = side === "new" ? merchant?.newValue : merchant?.oldValue;
  const categoryValue = side === "new" ? category?.newValue : category?.oldValue;
  if (typeof merchantValue !== "string" || !isCategoryId(categoryValue)) return state;
  return { ...state, merchantRules: rememberMerchant(state.merchantRules, merchantValue, categoryValue) };
}

function rememberFromValues(
  state: AppState,
  values: AssistantAuditEntry["before"]
): AppState {
  const merchant = values.find((row) => row.field === "merchant" && row.entity.startsWith("expense:"));
  const category = values.find((row) => row.field === "categoryId" && row.entity.startsWith("expense:"));
  if (typeof merchant?.value !== "string" || !isCategoryId(category?.value)) return state;
  return { ...state, merchantRules: rememberMerchant(state.merchantRules, merchant.value, category.value) };
}

function readField(state: AppState, entity: string, field: string): ProposalScalar | undefined {
  if (entity === "expense:new") {
    if (!EXPENSE_FIELDS.has(field)) return undefined;
    return field === "exists" ? false : null;
  }
  if (entity === "checking") {
    if (field !== "checkingCents") return undefined;
    return Number.isFinite(state.checkingCents) ? state.checkingCents : 0;
  }
  if (entity.startsWith("envelope:")) {
    const category = state.categories.find((entry) => entry.id === entity.slice("envelope:".length));
    if (!category || field !== "monthlyBudgetCents") return undefined;
    return category.monthlyBudgetCents;
  }
  if (entity.startsWith("bill:")) {
    const bill = state.bills.find((entry) => entry.id === entity.slice("bill:".length));
    if (!bill) return undefined;
    if (field === "amountCents") return bill.amountCents;
    if (field === "dueDate") return bill.dueDate;
    if (field === "paid") return bill.paid;
    if (field === "paidExpenseId") return bill.paidExpenseId ?? null;
    return undefined;
  }
  if (entity.startsWith("expense:")) {
    if (!EXPENSE_FIELDS.has(field)) return undefined;
    const expense = state.expenses.find((entry) => entry.id === entity.slice("expense:".length));
    if (!expense) return field === "exists" ? false : null;
    if (field === "exists") return true;
    if (field === "amountCents") return expense.amountCents;
    if (field === "merchant") return expense.merchant;
    if (field === "categoryId") return expense.categoryId;
    if (field === "date") return expense.date;
    if (field === "note") return expense.note;
    if (field === "source") return expense.source;
    if (field === "autoCategorized") return expense.autoCategorized;
    if (field === "createdAt") return expense.createdAt;
  }
  return undefined;
}

function writeField(state: AppState, change: ProposalChange, now: Date): AppState {
  const current = readField(state, change.entity, change.field);
  if (current !== undefined && current === change.newValue) return state;
  const stamp = now.toISOString();

  if (change.field === "exists" && change.entity.startsWith("expense:")) {
    const id = change.entity.slice("expense:".length);
    if (!id) return state;
    if (change.newValue === true) return ensureExpense(state, id, stamp);
    if (change.newValue === false) {
      return { ...state, expenses: state.expenses.filter((expense) => expense.id !== id) };
    }
    return state;
  }

  if (change.newValue === null) {
    if (change.field === "paidExpenseId" && change.entity.startsWith("bill:")) {
      return updateBill(state, change.entity.slice("bill:".length), stamp, (bill) => ({
        ...bill,
        paidExpenseId: undefined,
      }));
    }
    return state;
  }

  if (change.entity === "checking" && change.field === "checkingCents" && typeof change.newValue === "number") {
    return { ...state, checkingCents: change.newValue, checkingUpdatedAt: stamp };
  }

  if (change.entity.startsWith("envelope:") && change.field === "monthlyBudgetCents" && typeof change.newValue === "number") {
    const id = change.entity.slice("envelope:".length);
    return {
      ...state,
      categories: state.categories.map((category) =>
        category.id === id ? { ...category, monthlyBudgetCents: change.newValue as number } : category
      ),
    };
  }

  if (change.entity.startsWith("bill:")) {
    const id = change.entity.slice("bill:".length);
    return updateBill(state, id, stamp, (bill) => {
      const next = { ...bill };
      if (change.field === "amountCents" && typeof change.newValue === "number") next.amountCents = change.newValue;
      if (change.field === "dueDate" && typeof change.newValue === "string") next.dueDate = change.newValue;
      if (change.field === "paid" && typeof change.newValue === "boolean") next.paid = change.newValue;
      if (change.field === "paidExpenseId" && typeof change.newValue === "string") next.paidExpenseId = change.newValue;
      return next;
    });
  }

  if (change.entity.startsWith("expense:")) {
    const id = change.entity.slice("expense:".length);
    return updateExpense(state, id, stamp, (expense) => {
      if (change.field === "amountCents" && typeof change.newValue === "number") expense.amountCents = change.newValue;
      if (change.field === "merchant" && typeof change.newValue === "string") expense.merchant = change.newValue;
      if (change.field === "categoryId" && isCategoryId(change.newValue)) expense.categoryId = change.newValue;
      if (change.field === "date" && typeof change.newValue === "string") expense.date = change.newValue;
      if (change.field === "note" && typeof change.newValue === "string") expense.note = change.newValue;
      if (change.field === "source" && isSource(change.newValue)) expense.source = change.newValue;
      if (change.field === "autoCategorized" && typeof change.newValue === "boolean") {
        expense.autoCategorized = change.newValue;
      }
      if (change.field === "createdAt" && typeof change.newValue === "string") expense.createdAt = change.newValue;
      return expense;
    });
  }

  return state;
}

function updateBill(
  state: AppState,
  id: string,
  stamp: string,
  patch: (bill: UpcomingBill) => UpcomingBill
): AppState {
  return {
    ...state,
    bills: state.bills.map((bill) => (bill.id === id ? { ...patch(bill), updatedAt: stamp } : bill)),
  };
}

function ensureExpense(state: AppState, id: string, stamp: string): AppState {
  if (state.expenses.some((expense) => expense.id === id)) return state;
  const expense: Expense = {
    id,
    amountCents: 0,
    merchant: "",
    note: "",
    categoryId: "misc",
    date: stamp.slice(0, 10),
    source: "manual",
    createdAt: stamp,
    autoCategorized: false,
  };
  return { ...state, expenses: [expense, ...state.expenses] };
}

function updateExpense(
  state: AppState,
  id: string,
  stamp: string,
  patch: (expense: Expense) => Expense
): AppState {
  const base = state.expenses.some((expense) => expense.id === id) ? state : ensureExpense(state, id, stamp);
  return {
    ...base,
    expenses: base.expenses.map((expense) => (expense.id === id ? patch({ ...expense }) : expense)),
  };
}

function categoryName(state: AppState, id: string): string {
  return state.categories.find((category) => category.id === id)?.name ?? id;
}

function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === "string" && (CATEGORY_IDS as readonly string[]).includes(value);
}

function isSource(value: unknown): value is ExpenseSource {
  return value === "manual" || value === "csv" || value === "bill";
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

function readString(
  input: Record<string, unknown>,
  key: string
): string | undefined | { ok: false; error: string } {
  if (!(key in input) || input[key] === undefined || input[key] === null || input[key] === "") return undefined;
  if (typeof input[key] !== "string") return { ok: false, error: `${key} must be a string.` };
  const trimmed = input[key].trim();
  return trimmed || undefined;
}

function readMoney(
  input: Record<string, unknown>,
  key: string
): number | { ok: false; error: string } {
  if (!(key in input) || input[key] === undefined || input[key] === null || input[key] === "") {
    return { ok: false, error: `${key} is required.` };
  }
  const raw = input[key];
  const numeric =
    typeof raw === "number"
      ? raw
      : typeof raw === "string"
        ? Number(raw.replace(/[$,\s]/g, ""))
        : Number.NaN;
  if (!Number.isFinite(numeric)) return { ok: false, error: `${key} must be a dollar amount.` };
  const cents = dollarsToCents(numeric);
  if (!Number.isSafeInteger(cents) || Math.abs(cents) > MAX_CENTS) {
    return { ok: false, error: `${key} is too large.` };
  }
  return cents;
}

function readDate(
  input: Record<string, unknown>,
  key: string,
  required: boolean
): string | undefined | { ok: false; error: string } {
  const value = readString(input, key);
  if (value && typeof value !== "string") return value;
  if (!value) {
    return required ? { ok: false, error: `${key} must be YYYY-MM-DD.` } : undefined;
  }
  if (!isIsoDate(value)) return { ok: false, error: `${key} must be YYYY-MM-DD.` };
  return value;
}

function mustCategory(
  state: AppState,
  input: Record<string, unknown>
): { category: AppState["categories"][number] } | { ok: false; error: string } {
  const found = readCategory(state, input, true);
  if ("error" in found) return found;
  if (!found.category) return { ok: false, error: `Name a category: ${CATEGORY_IDS.join(", ")}.` };
  return { category: found.category };
}

function readCategory(
  state: AppState,
  input: Record<string, unknown>,
  required: boolean
): { category: AppState["categories"][number] } | { category: null } | { ok: false; error: string } {
  const value = readString(input, "category");
  if (value && typeof value !== "string") return value;
  if (!value) {
    return required
      ? { ok: false, error: `Name a category: ${CATEGORY_IDS.join(", ")}.` }
      : { category: null };
  }
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
  return { ok: false, error: `Unknown category "${value}". Use ${CATEGORY_IDS.join(", ")}.` };
}

function readBill(
  state: AppState,
  input: Record<string, unknown>
): { bill: UpcomingBill } | { ok: false; error: string } {
  const value = readString(input, "bill");
  if (value && typeof value !== "string") return value;
  if (!value) return { ok: false, error: "Name the bill." };
  const text = value.toLowerCase();
  const byId = state.bills.find((bill) => bill.id.toLowerCase() === text);
  if (byId) return { bill: byId };
  const byName = state.bills.filter((bill) => bill.name.toLowerCase() === text);
  if (byName.length === 1) return { bill: byName[0]! };
  if (byName.length > 1) return { ok: false, error: ambiguousBills(value, byName) };
  const alias = billAlias(text);
  if (alias) {
    const aliased = state.bills.find((bill) => bill.id === alias);
    if (aliased) return { bill: aliased };
  }
  const fuzzy = state.bills.filter(
    (bill) => bill.name.toLowerCase().includes(text) || text.includes(bill.name.toLowerCase())
  );
  if (fuzzy.length === 1) return { bill: fuzzy[0]! };
  if (fuzzy.length > 1) return { ok: false, error: ambiguousBills(value, fuzzy) };
  const names = state.bills.map((bill) => bill.name).join(", ") || "none";
  return { ok: false, error: `No bill matches "${value}". Bills: ${names}.` };
}

function billAlias(text: string): string | null {
  if (/\bamex\b|american express/.test(text)) return "amex";
  if (/\bapple\b/.test(text)) return "apple-card";
  if (/\bbofa\b|\bboa\b|bank of america/.test(text)) return "bofa";
  if (/\brent\b/.test(text)) return "rent";
  return null;
}

function ambiguousBills(label: string, bills: UpcomingBill[]): string {
  const list = bills
    .slice(0, 3)
    .map((bill) => `${bill.name} (${bill.id})`)
    .join(", ");
  return `Several bills match "${label}". Ask which one: ${list}.`;
}

function findExpense(
  state: AppState,
  input: Record<string, unknown>
): { expense: Expense } | { ok: false; error: string } {
  const id = readString(input, "expenseId");
  if (id && typeof id !== "string") return id;
  if (id) {
    const expense = state.expenses.find((entry) => entry.id === id);
    if (!expense) return { ok: false, error: `No charge has id "${id}".` };
    return { expense };
  }
  const merchant = readString(input, "merchant");
  if (merchant && typeof merchant !== "string") return merchant;
  if (!merchant) return { ok: false, error: "Name the charge, or pass its id." };
  const date = readDate(input, "date", false);
  if (typeof date !== "string" && date !== undefined) return date;
  const needle = merchant.toLowerCase();
  let matches = state.expenses.filter((expense) => expense.merchant.toLowerCase().includes(needle));
  if (date) matches = matches.filter((expense) => expense.date === date);
  if (matches.length === 0) return { ok: false, error: `No charge matches "${merchant}".` };
  if (matches.length > 1) {
    const list = matches
      .slice(0, 2)
      .map((expense) => `${expense.merchant} ${formatCents(expense.amountCents)} ${expense.date} id ${expense.id}`)
      .join("; ");
    return { ok: false, error: `Several charges match "${merchant}". Ask which one: ${list}.` };
  }
  return { expense: matches[0]! };
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
