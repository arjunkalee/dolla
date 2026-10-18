import { readFileSync } from "node:fs";
import path from "node:path";
import { createSessionToken } from "../lib/auth";
import { handleApplyRequest, handleCancelRequest, handleUndoRequest } from "../lib/assistant/apply-edit";
import type { AssistantStreamCall } from "../lib/assistant/handle";
import { handleAssistantRequest } from "../lib/assistant/handle";
import { ASSISTANT_SYSTEM_PROMPT } from "../lib/assistant/prompt";
import {
  commitProposal,
  executeEditTool,
  STALE_EDIT_MESSAGE,
} from "../lib/assistant/proposals";
import { executeAssistantTool } from "../lib/assistant/tools";
import { normalizeMerchant } from "../lib/categorize";
import { parseChat } from "../lib/chat";
import { formatCents } from "../lib/money";
import { realState } from "../lib/seed";
import type { AppState, ChatProposal, Expense } from "../lib/types";

function expect(label: string, cond: unknown, detail = "") {
  if (!cond) throw new Error(detail ? `${label}: ${detail}` : label);
}

function expectEq(label: string, got: unknown, want: unknown) {
  if (got !== want) throw new Error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const NOW = new Date("2026-10-15T18:00:00.000Z");
const FAKE_KEY = "test-not-a-real-key";

function expense(partial: Pick<Expense, "id" | "amountCents" | "merchant" | "categoryId" | "date">): Expense {
  return {
    note: "",
    source: "manual",
    createdAt: "2026-10-02T15:00:00.000Z",
    autoCategorized: false,
    ...partial,
  };
}

function fresh(): AppState {
  const state = realState(NOW);
  state.expenses = [
    expense({
      id: "chipotle",
      amountCents: 4_500,
      merchant: "Chipotle",
      categoryId: "dining",
      date: "2026-10-02",
    }),
    expense({
      id: "chipotle-2",
      amountCents: 1_200,
      merchant: "Chipotle",
      categoryId: "dining",
      date: "2026-10-04",
    }),
  ];
  state.checkingCents = 495_201;
  return state;
}

function money(state: AppState) {
  return {
    checking: state.checkingCents,
    envelopes: state.categories.map((category) => [category.id, category.monthlyBudgetCents]),
    bills: state.bills.map((bill) => [bill.id, bill.amountCents, bill.dueDate, bill.paid, bill.paidExpenseId ?? null]),
    expenses: state.expenses.map((entry) => [entry.id, entry.amountCents, entry.merchant, entry.categoryId, entry.date]),
  };
}

function attach(state: AppState, proposal: ChatProposal): AppState {
  return {
    ...state,
    chatMessages: [
      ...state.chatMessages,
      {
        id: `msg-${proposal.id}`,
        role: "dolla",
        text: proposal.summary,
        createdAt: NOW.toISOString(),
        proposals: [proposal],
      },
    ],
  };
}

function proposalOf(outcome: ReturnType<typeof executeEditTool>): ChatProposal {
  if (!outcome.ok) throw new Error(outcome.error);
  return outcome.proposal;
}

let ids = 0;
function nextId() {
  ids += 1;
  return `p${ids}`;
}

function propose(state: AppState, name: string, input: unknown) {
  const before = JSON.stringify(money(state));
  const outcome = executeEditTool(state, name, input, NOW, nextId);
  expectEq(`${name} does not write`, JSON.stringify(money(state)), before);
  return outcome;
}

function holder(start: AppState) {
  const box: { state: AppState } = { state: start };
  const update = async (mutator: (state: AppState) => AppState) => {
    box.state = mutator(box.state);
    return box.state;
  };
  return { box, update };
}

async function main() {
  expect("prompt never invents a balance", /Never invent a balance/.test(ASSISTANT_SYSTEM_PROMPT));
  expect("prompt asks when ambiguous", /ask which one/i.test(ASSISTANT_SYSTEM_PROMPT));
  expect("prompt waits for confirm", /nothing changes until he confirms/i.test(ASSISTANT_SYSTEM_PROMPT));
  expect(
    "prompt treats $10 for restaurant as a purchase",
    /\$10 for restaurant/.test(ASSISTANT_SYSTEM_PROMPT) && /do not resize the envelope/i.test(ASSISTANT_SYSTEM_PROMPT)
  );

  const parsed = parseChat("$10 for restaurant", fresh());
  expectEq("parser still logs a restaurant purchase first", parsed.type, "log-expense");

  const state = fresh();
  const logged = proposalOf(
    propose(state, "propose_log_expense", { amount: 10, merchant: "Restaurant", category: "dining" })
  );
  expectEq("log tool", logged.tool, "propose_log_expense");
  expectEq("log starts pending", logged.status, "pending");
  expect("log is not an envelope resize", logged.changes.every((change) => change.field !== "monthlyBudgetCents"));
  const logAmount = logged.changes.find((change) => change.field === "amountCents");
  expectEq("log old amount is empty", logAmount?.oldValue, null);
  expectEq("log new amount is $10", logAmount?.newValue, 1_000);
  const logChecking = logged.changes.find((change) => change.entity === "checking");
  expectEq("log checking old", logChecking?.oldValue, 495_201);
  expectEq("log checking new", logChecking?.newValue, 494_201);
  const logData = executeEditTool(state, "propose_log_expense", { amount: 10, merchant: "Restaurant", category: "dining" }, NOW, nextId);
  if (!logData.ok) throw new Error(logData.error);
  const shown = logData.data as { saved: boolean; proposed: boolean; changes: Array<{ entity: string; field: string; oldValue: string; newValue: string }> };
  expectEq("tool result is not saved", shown.saved, false);
  expectEq("tool result is a proposal", shown.proposed, true);
  expect("shown diff has entity, field, old, new", shown.changes.every((change) => change.entity && change.field && "oldValue" in change && "newValue" in change));

  const envelope = proposalOf(propose(state, "propose_envelope_amount", { category: "Restaurant / dining", amount: 350 }));
  expectEq("envelope entity", envelope.changes[0]?.entity, "envelope:dining");
  expectEq("envelope old", envelope.changes[0]?.oldValue, 40_000);
  expectEq("envelope new", envelope.changes[0]?.newValue, 35_000);
  const sameEnvelope = propose(state, "propose_envelope_amount", { category: "dining", amount: 400 });
  expect("same envelope is not a card", !sameEnvelope.ok);

  const ambiguous = propose(state, "propose_delete_expense", { merchant: "Chipotle" });
  expect("ambiguous delete asks", !ambiguous.ok && /Ask which one/.test(ambiguous.error));

  const missingBill = propose(state, "propose_bill_amount", { bill: "yacht club", amount: 20 });
  expect("unknown bill errors", !missingBill.ok);

  const { box, update } = holder(attach(fresh(), logged));
  const denied = await handleApplyRequest({ sessionToken: null, proposalId: logged.id, update });
  expectEq("apply without a session is 401", denied.status, 401);
  expectEq("locked apply does not write", box.state.checkingCents, 495_201);

  const token = await createSessionToken();
  const applied = await handleApplyRequest({
    sessionToken: token,
    proposalId: logged.id,
    now: NOW,
    update,
    ids: { auditId: () => "audit-log", expenseId: () => "exp-restaurant" },
  });
  expectEq("confirm apply status", applied.status, 200);
  const appliedBody = await applied.json();
  expectEq("apply audit id", appliedBody.auditId, "audit-log");
  expect("apply body has no key", !JSON.stringify(appliedBody).includes(FAKE_KEY));
  expectEq("log checking after confirm", box.state.checkingCents, 494_201);
  const created = box.state.expenses.find((entry) => entry.id === "exp-restaurant");
  expect("purchase was logged", created);
  expectEq("logged merchant", created?.merchant, "Restaurant");
  expectEq("logged category", created?.categoryId, "dining");
  expectEq("logged amount", created?.amountCents, 1_000);
  expectEq("dining budget untouched", box.state.categories.find((category) => category.id === "dining")?.monthlyBudgetCents, 40_000);
  const audit = box.state.assistantAudit?.find((entry) => entry.id === "audit-log");
  expect("audit exists", audit);
  expectEq("audit source", audit?.source, "assistant");
  expectEq("audit tool", audit?.tool, "propose_log_expense");
  expect("audit has a timestamp", Boolean(audit?.at && !Number.isNaN(Date.parse(audit.at))));
  expectEq("audit before checking", audit?.before.find((row) => row.field === "checkingCents")?.value, 495_201);
  expectEq("audit after checking", audit?.after.find((row) => row.field === "checkingCents")?.value, 494_201);
  expectEq("card is applied", box.state.chatMessages.at(-1)?.proposals?.[0]?.status, "applied");

  const again = await handleApplyRequest({
    sessionToken: token,
    proposalId: logged.id,
    now: NOW,
    update,
  });
  expectEq("second confirm does not apply twice", again.status, 409);
  const againBody = await again.json();
  expect("second confirm message", /already confirmed/i.test(String(againBody.error)));
  expectEq("checking stays after second confirm", box.state.checkingCents, 494_201);
  expectEq("still one new purchase", box.state.expenses.filter((entry) => entry.id === "exp-restaurant").length, 1);

  const undone = await handleUndoRequest({
    sessionToken: token,
    auditId: "audit-log",
    now: NOW,
    update,
  });
  expectEq("undo status", undone.status, 200);
  expectEq("undo restores checking", box.state.checkingCents, 495_201);
  expect("undo removes the purchase", !box.state.expenses.some((entry) => entry.id === "exp-restaurant"));
  expectEq("audit marked undone", box.state.assistantAudit?.find((entry) => entry.id === "audit-log")?.undoneAt, NOW.toISOString());
  expectEq("card is undone", box.state.chatMessages.at(-1)?.proposals?.[0]?.status, "undone");

  const undoAgain = await handleUndoRequest({
    sessionToken: token,
    auditId: "audit-log",
    now: NOW,
    update,
  });
  expectEq("second undo is rejected", undoAgain.status, 409);

  const dining = proposalOf(propose(fresh(), "propose_envelope_amount", { category: "dining", amount: 350 }));
  const staleBox = holder(attach(fresh(), dining));
  staleBox.box.state = {
    ...staleBox.box.state,
    categories: staleBox.box.state.categories.map((category) =>
      category.id === "dining" ? { ...category, monthlyBudgetCents: 36_000 } : category
    ),
  };
  const stale = await handleApplyRequest({
    sessionToken: token,
    proposalId: dining.id,
    now: NOW,
    update: staleBox.update,
    ids: { auditId: () => "audit-stale", expenseId: () => "exp-stale" },
  });
  expectEq("stale apply status", stale.status, 409);
  const staleBody = await stale.json();
  expectEq("stale apply message", staleBody.error, STALE_EDIT_MESSAGE);
  expect("stale message asks again", /value changed/i.test(String(staleBody.error)) && /ask again/i.test(String(staleBody.error)));
  expectEq("stale apply leaves the new budget", staleBox.box.state.categories.find((category) => category.id === "dining")?.monthlyBudgetCents, 36_000);
  expectEq("stale card", staleBox.box.state.chatMessages.at(-1)?.proposals?.[0]?.status, "stale");
  expectEq("stale apply writes no audit", staleBox.box.state.assistantAudit?.length ?? 0, 0);

  const checkingCard = proposalOf(propose(fresh(), "propose_checking_balance", { amount: 5100 }));
  const undoStale = holder(attach(fresh(), checkingCard));
  const checkingApplied = await handleApplyRequest({
    sessionToken: token,
    proposalId: checkingCard.id,
    now: NOW,
    update: undoStale.update,
    ids: { auditId: () => "audit-checking", expenseId: () => "exp-none" },
  });
  expectEq("checking apply", checkingApplied.status, 200);
  expectEq("checking is 5100", undoStale.box.state.checkingCents, 510_000);
  undoStale.box.state = { ...undoStale.box.state, checkingCents: 100 };
  const undoBlocked = await handleUndoRequest({
    sessionToken: token,
    auditId: "audit-checking",
    now: NOW,
    update: undoStale.update,
  });
  expectEq("stale undo status", undoBlocked.status, 409);
  const undoBlockedBody = await undoBlocked.json();
  expectEq("stale undo message", undoBlockedBody.error, STALE_EDIT_MESSAGE);
  expectEq("stale undo leaves checking", undoStale.box.state.checkingCents, 100);
  expect("stale undo does not mark the audit", !undoStale.box.state.assistantAudit?.find((entry) => entry.id === "audit-checking")?.undoneAt);

  const billAmount = proposalOf(propose(fresh(), "propose_bill_amount", { bill: "Amex", amount: 1500 }));
  const billDue = proposalOf(propose(fresh(), "propose_bill_due_date", { bill: "apple", dueDate: "2026-10-20" }));
  const billPaid = proposalOf(propose(fresh(), "propose_bill_paid", { bill: "Apple Card", paid: true }));
  const recat = proposalOf(
    propose(fresh(), "propose_recategorize_expense", { expenseId: "chipotle", category: "groceries" })
  );
  const remove = proposalOf(propose(fresh(), "propose_delete_expense", { expenseId: "chipotle" }));
  expectEq("bill amount old", billAmount.changes[0]?.oldValue, 141_652);
  expectEq("bill amount new", billAmount.changes[0]?.newValue, 150_000);
  expectEq("bill due old", billDue.changes[0]?.oldValue, "2026-08-30");
  expectEq("bill due new", billDue.changes[0]?.newValue, "2026-10-20");
  expect("paid card changes paid and checking", billPaid.changes.some((change) => change.field === "paid" && change.newValue === true) && billPaid.changes.some((change) => change.field === "checkingCents"));
  expectEq("recategorize old", recat.changes.find((change) => change.field === "categoryId")?.oldValue, "dining");
  expectEq("recategorize new", recat.changes.find((change) => change.field === "categoryId")?.newValue, "groceries");
  expectEq("delete old amount", remove.changes.find((change) => change.field === "amountCents")?.oldValue, 4_500);

  const bills = holder(attach(attach(attach(fresh(), billAmount), billDue), billPaid));
  for (const [id, auditId] of [
    [billAmount.id, "audit-amount"],
    [billDue.id, "audit-due"],
    [billPaid.id, "audit-paid"],
  ] as const) {
    const res = await handleApplyRequest({
      sessionToken: token,
      proposalId: id,
      now: NOW,
      update: bills.update,
      ids: { auditId: () => auditId, expenseId: () => "exp-apple" },
    });
    expectEq(`${auditId} apply`, res.status, 200);
    await res.json();
  }
  const amex = bills.box.state.bills.find((bill) => bill.id === "amex");
  const apple = bills.box.state.bills.find((bill) => bill.id === "apple-card");
  expectEq("amex amount saved", amex?.amountCents, 150_000);
  expectEq("apple due saved", apple?.dueDate, "2026-10-20");
  expectEq("apple paid", apple?.paid, true);
  expectEq("apple payment link", apple?.paidExpenseId, "exp-apple");
  expectEq("paying subtracts the bill from checking", bills.box.state.checkingCents, 495_201 - 69_426);
  const payment = bills.box.state.expenses.find((entry) => entry.id === "exp-apple");
  expectEq("payment source", payment?.source, "bill");
  expectEq("payment amount", payment?.amountCents, 69_426);
  const paidUndo = await handleUndoRequest({
    sessionToken: token,
    auditId: "audit-paid",
    now: NOW,
    update: bills.update,
  });
  expectEq("undo paid status", paidUndo.status, 200);
  expectEq("apple unpaid again", bills.box.state.bills.find((bill) => bill.id === "apple-card")?.paid, false);
  expect("payment expense removed", !bills.box.state.expenses.some((entry) => entry.id === "exp-apple"));
  expectEq("checking restored after unpaid", bills.box.state.checkingCents, 495_201);
  expectEq("amex amount survives the undo", bills.box.state.bills.find((bill) => bill.id === "amex")?.amountCents, 150_000);

  const moves = holder(attach(attach(fresh(), recat), remove));
  const moved = await handleApplyRequest({
    sessionToken: token,
    proposalId: recat.id,
    now: NOW,
    update: moves.update,
    ids: { auditId: () => "audit-move", expenseId: () => "exp-move" },
  });
  expectEq("recategorize apply", moved.status, 200);
  await moved.json();
  expectEq("chipotle moved", moves.box.state.expenses.find((entry) => entry.id === "chipotle")?.categoryId, "groceries");
  expectEq("merchant rule follows", moves.box.state.merchantRules[normalizeMerchant("Chipotle")], "groceries");
  const movedBack = await handleUndoRequest({ sessionToken: token, now: NOW, update: moves.update });
  expectEq("undo most recent recategorize", movedBack.status, 200);
  expectEq("chipotle restored", moves.box.state.expenses.find((entry) => entry.id === "chipotle")?.categoryId, "dining");
  expectEq("merchant rule restored", moves.box.state.merchantRules[normalizeMerchant("Chipotle")], "dining");

  const deleted = await handleApplyRequest({
    sessionToken: token,
    proposalId: remove.id,
    now: NOW,
    update: moves.update,
    ids: { auditId: () => "audit-delete", expenseId: () => "exp-delete" },
  });
  expectEq("delete apply", deleted.status, 200);
  await deleted.json();
  expect("chipotle deleted", !moves.box.state.expenses.some((entry) => entry.id === "chipotle"));
  expectEq("delete refunds checking", moves.box.state.checkingCents, 495_201 + 4_500);
  const deleteUndo = await handleUndoRequest({ sessionToken: token, now: NOW, update: moves.update });
  expectEq("undo most recent delete", deleteUndo.status, 200);
  const restored = moves.box.state.expenses.find((entry) => entry.id === "chipotle");
  expectEq("deleted charge comes back", restored?.amountCents, 4_500);
  expectEq("restored merchant", restored?.merchant, "Chipotle");
  expectEq("restored category", restored?.categoryId, "dining");
  expectEq("checking back after delete undo", moves.box.state.checkingCents, 495_201);

  const cancelCard = proposalOf(propose(fresh(), "propose_checking_balance", { amount: 20 }));
  const cancelBox = holder(attach(fresh(), cancelCard));
  const cancelled = await handleCancelRequest({
    sessionToken: token,
    proposalId: cancelCard.id,
    update: cancelBox.update,
  });
  expectEq("cancel status", cancelled.status, 200);
  expectEq("cancel does not change checking", cancelBox.box.state.checkingCents, 495_201);
  expectEq("card cancelled", cancelBox.box.state.chatMessages.at(-1)?.proposals?.[0]?.status, "cancelled");
  const cancelApply = await handleApplyRequest({
    sessionToken: token,
    proposalId: cancelCard.id,
    now: NOW,
    update: cancelBox.update,
  });
  expectEq("cancelled card cannot apply", cancelApply.status, 409);
  expectEq("checking still unchanged", cancelBox.box.state.checkingCents, 495_201);

  const direct = fresh();
  const directCard = proposalOf(propose(direct, "propose_envelope_amount", { category: "gas", amount: 80 }));
  const withCard = attach(direct, directCard);
  const committed = commitProposal(withCard, directCard.id, NOW, {
    auditId: () => "audit-gas",
    expenseId: () => "exp-gas",
  });
  expectEq("direct commit", committed.ok, true);
  expectEq("gas budget", committed.state.categories.find((category) => category.id === "gas")?.monthlyBudgetCents, 8_000);
  expectEq("direct commit leaves the input budget", direct.categories.find((category) => category.id === "gas")?.monthlyBudgetCents, 10_000);

  const streamBox = holder(fresh());
  const calls: AssistantStreamCall[] = [];
  let streamedProposals: ChatProposal[] = [];
  const streamed = await handleAssistantRequest({
    sessionToken: token,
    text: "log ten dollars at a restaurant tonight",
    now: NOW,
    env: { ANTHROPIC_API_KEY: FAKE_KEY, DOLLA_AI_MONTHLY_CAP_USD: "10" },
    loadLedger: async () => streamBox.box.state,
    mutateUsage: async (mutator) => mutator({ months: {}, recentRequestAt: [] }),
    appendExchange: async (_user, reply, exchange) => {
      const proposals = exchange?.proposals ?? [];
      streamedProposals = proposals;
      streamBox.box.state = {
        ...streamBox.box.state,
        chatMessages: [
          ...streamBox.box.state.chatMessages,
          {
            id: "stream-dolla",
            role: "dolla",
            text: reply,
            createdAt: NOW.toISOString(),
            proposals,
          },
        ],
      };
    },
    streamReply: async (args) => {
      calls.push(args);
      if (calls.length === 1) {
        return {
          inputTokens: 10,
          outputTokens: 5,
          cacheCreation5mTokens: 0,
          cacheCreation1hTokens: 0,
          cacheReadTokens: 0,
          stopReason: "tool_use",
          toolUses: [
            {
              type: "tool_use" as const,
              id: "toolu_log",
              name: "propose_log_expense",
              input: { amount: 10, merchant: "Restaurant", category: "dining" },
            },
          ],
        };
      }
      const blocks = args.messages.flatMap((message) => (Array.isArray(message.content) ? message.content : []));
      const result = blocks.find((block) => {
        const row = block as { type?: string; tool_use_id?: string };
        return row.type === "tool_result" && row.tool_use_id === "toolu_log";
      }) as { content?: string; is_error?: boolean } | undefined;
      if (!result || result.is_error) throw new Error(`expected a proposal result, got ${JSON.stringify(result)}`);
      const data = JSON.parse(result.content ?? "{}") as { saved?: boolean; proposed?: boolean };
      if (data.saved !== false || data.proposed !== true) throw new Error("proposal was saved inside the tool");
      args.onText("Confirm the card to log $10 at Restaurant.");
      return {
        inputTokens: 4,
        outputTokens: 8,
        cacheCreation5mTokens: 0,
        cacheCreation1hTokens: 0,
        cacheReadTokens: 0,
        stopReason: "end_turn",
        toolUses: [],
      };
    },
  });
  const streamBody = await streamed.text();
  expectEq("proposal turn streams", streamed.status, 200);
  expect("stream includes the confirm card", streamBody.includes("\"proposal\""));
  expect("stream does not leak the key", !streamBody.includes(FAKE_KEY));
  expectEq("tool did not log the purchase", streamBox.box.state.expenses.length, 2);
  expectEq("tool did not move checking", streamBox.box.state.checkingCents, 495_201);
  expectEq("reply asks for the card", streamBox.box.state.chatMessages.at(-1)?.text, "Confirm the card to log $10 at Restaurant.");
  const streamedCard = streamedProposals[0];
  expect("stream stored the card", streamedCard);
  const streamApply = await handleApplyRequest({
    sessionToken: token,
    proposalId: streamedCard!.id,
    now: NOW,
    update: streamBox.update,
    ids: { auditId: () => "audit-stream", expenseId: () => "exp-stream" },
  });
  expectEq("stream card applies", streamApply.status, 200);
  await streamApply.json();
  expectEq("stream confirm logs the purchase", streamBox.box.state.expenses.some((entry) => entry.id === "exp-stream"), true);
  expectEq("stream confirm moves checking", streamBox.box.state.checkingCents, 494_201);
  const streamUndo = await handleUndoRequest({ sessionToken: token, now: NOW, update: streamBox.update });
  expectEq("undo most recent stream edit", streamUndo.status, 200);
  expect("most recent undo removes the purchase", !streamBox.box.state.expenses.some((entry) => entry.id === "exp-stream"));
  expectEq("most recent undo restores checking", streamBox.box.state.checkingCents, 495_201);

  const emptyUndo = await handleUndoRequest({
    sessionToken: token,
    now: NOW,
    update: async (mutator) => mutator(fresh()),
  });
  expectEq("undo with nothing to undo", emptyUndo.status, 404);

  const assistantTool = executeAssistantTool(fresh(), "propose_checking_balance", { amount: 12 }, NOW);
  expect("dispatcher returns a proposal", assistantTool.ok && assistantTool.proposal?.tool === "propose_checking_balance");
  const unknown = executeAssistantTool(fresh(), "erase_ledger", {}, NOW);
  expect("unknown edit is still refused", !unknown.ok && unknown.error === "That tool is not available. Reads only.");

  const root = process.cwd();
  const proposals = readFileSync(path.join(root, "lib/assistant/proposals.ts"), "utf8");
  const loop = readFileSync(path.join(root, "lib/assistant/loop.ts"), "utf8");
  const applyRoute = readFileSync(path.join(root, "app/api/assistant/apply/route.ts"), "utf8");
  const undoRoute = readFileSync(path.join(root, "app/api/assistant/undo/route.ts"), "utf8");
  const cancelRoute = readFileSync(path.join(root, "app/api/assistant/cancel/route.ts"), "utf8");
  expect("proposals do not import the store", !proposals.includes("lib/store"));
  expect("proposals do not write", !/saveState|updateState|logPurchase/.test(proposals));
  expect("tool loop does not apply edits", !/commitProposal|saveState|updateState/.test(loop));
  expect("apply route is session gated", applyRoute.includes("sessionCookieName()") && applyRoute.includes("handleApplyRequest"));
  expect("undo route is session gated", undoRoute.includes("sessionCookieName()") && undoRoute.includes("handleUndoRequest"));
  expect("cancel route is session gated", cancelRoute.includes("sessionCookieName()") && cancelRoute.includes("handleCancelRequest"));
  expect(
    "edit routes do not print a key or pin",
    ![applyRoute, undoRoute, cancelRoute, proposals].some((source) => /sk-ant-|DOLLA_PIN|console\.log\(/.test(source))
  );
  expectEq(
    "a logged purchase formats in dollars",
    formatCents(1_000),
    "$10.00"
  );

  console.log("assistant edits ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
