import { readFileSync } from "node:fs";
import path from "node:path";
import { createSessionToken } from "../lib/auth";
import type { AssistantStreamCall } from "../lib/assistant/handle";
import { handleAssistantRequest } from "../lib/assistant/handle";
import { MAX_TOOL_ROUNDS, TOOL_LOOP_LIMIT_MESSAGE, type AssistantRound } from "../lib/assistant/loop";
import {
  costMicroUsd,
  priceForModel,
  type TokenUsage,
} from "../lib/assistant/pricing";
import { ASSISTANT_SYSTEM_PROMPT } from "../lib/assistant/prompt";
import {
  cachedAssistantTools,
  DEFAULT_TRANSACTION_LIMIT,
  executeReadTool,
  MAX_TRANSACTION_LIMIT,
  READ_TOOL_NAMES,
  type ToolOutcome,
} from "../lib/assistant/tools";
import { emptyAiUsage, emptyMonth, type AiUsageLedger } from "../lib/assistant/usage";
import { formatCents } from "../lib/money";
import { realState } from "../lib/seed";
import type { AppState, Expense } from "../lib/types";

function expect(label: string, cond: unknown, detail = "") {
  if (!cond) throw new Error(detail ? `${label}: ${detail}` : label);
}

function expectEq(label: string, got: unknown, want: unknown) {
  if (got !== want) throw new Error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const NOW = new Date("2026-10-15T18:00:00.000Z");
const FAKE_KEY = "test-not-a-real-key";
const PRICE = priceForModel("claude-sonnet-5-5");

function sampleUsage(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
    cacheReadTokens: 0,
    ...overrides,
  };
}

function expense(partial: Pick<Expense, "id" | "amountCents" | "merchant" | "categoryId" | "date"> & { createdAt?: string }): Expense {
  return {
    note: "",
    source: "manual",
    createdAt: partial.createdAt ?? NOW.toISOString(),
    autoCategorized: false,
    ...partial,
  };
}

function ledger(): AppState {
  const state = realState(NOW);
  state.expenses = [
    expense({
      id: "chipotle",
      amountCents: 4_500,
      merchant: "Chipotle",
      categoryId: "dining",
      date: "2026-10-02",
      createdAt: "2026-10-02T15:00:00.000Z",
    }),
    expense({
      id: "jewel",
      amountCents: 8_000,
      merchant: "Jewel Osco",
      categoryId: "groceries",
      date: "2026-10-03",
      createdAt: "2026-10-03T15:00:00.000Z",
    }),
    expense({
      id: "old-cafe",
      amountCents: 1_200,
      merchant: "Old Cafe",
      categoryId: "dining",
      date: "2026-09-02",
      createdAt: "2026-09-02T15:00:00.000Z",
    }),
  ];
  return state;
}

function diningLeftCents(state: AppState): number {
  const budget = state.categories.find((category) => category.id === "dining")?.monthlyBudgetCents ?? 0;
  const spent = state.expenses
    .filter((entry) => entry.categoryId === "dining" && entry.date.startsWith("2026-10"))
    .reduce((sum, entry) => sum + entry.amountCents, 0);
  return budget - spent;
}

type ToolResultBlock = {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
  cache_control?: unknown;
};

function toolResults(messages: AssistantStreamCall["messages"]): ToolResultBlock[] {
  const results: ToolResultBlock[] = [];
  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (!block || typeof block !== "object") continue;
      const record = block as { type?: string };
      if (record.type === "tool_result") results.push(block as ToolResultBlock);
    }
  }
  return results;
}

function harness(start: AiUsageLedger | undefined, state: AppState) {
  let ledger = start ?? emptyAiUsage();
  const calls: AssistantStreamCall[] = [];
  const saved: Array<{ user: string; reply: string }> = [];
  const before = JSON.stringify(state);

  async function run(
    text: string,
    streamReply: (args: AssistantStreamCall) => Promise<AssistantRound>,
    options?: {
      executeTool?: (current: AppState, name: string, input: unknown, now: Date) => ToolOutcome;
    }
  ) {
    return handleAssistantRequest({
      sessionToken: await createSessionToken(),
      text,
      now: NOW,
      env: { ANTHROPIC_API_KEY: FAKE_KEY, DOLLA_AI_MONTHLY_CAP_USD: "10" },
      loadLedger: async () => state,
      mutateUsage: async (mutator) => {
        ledger = mutator(ledger);
        return structuredClone(ledger);
      },
      appendExchange: async (user, reply) => {
        saved.push({ user, reply });
      },
      executeTool: options?.executeTool,
      streamReply: async (args) => {
        calls.push({ ...args, messages: structuredClone(args.messages) });
        return streamReply(args);
      },
    });
  }

  return {
    run,
    calls,
    saved,
    ledger: () => ledger,
    unchanged: () => JSON.stringify(state) === before,
  };
}

async function withUsageLogs(run: () => Promise<void>): Promise<string[]> {
  const logs: string[] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    await run();
  } finally {
    console.info = original;
  }
  return logs.filter((line) => line.includes("dolla.assistant.usage"));
}

function payload(state: AppState, name: string, input: unknown) {
  const outcome = executeReadTool(state, name, input, NOW);
  if (!outcome.ok) throw new Error(`${name} failed: ${outcome.error}`);
  return outcome.data as Record<string, unknown>;
}

async function main() {
  const tools = cachedAssistantTools();
  expectEq("tool names", tools.map((tool) => tool.name).join(","), READ_TOOL_NAMES.join(","));
  expectEq("last tool cached", tools.at(-1)?.cache_control?.type, "ephemeral");
  expect(
    "only the last tool is a cache breakpoint",
    tools.slice(0, -1).every((tool) => tool.cache_control == null)
  );
  for (const tool of tools) {
    expect(`${tool.name} has a description`, (tool.description?.length ?? 0) > 40);
    expect(`${tool.name} schema is an object`, tool.input_schema.type === "object");
  }
  expect("tool definitions have no live balance", !JSON.stringify(tools).includes("4,952.01"));
  expect("cached prompt has no live balance", !ASSISTANT_SYSTEM_PROMPT.includes("4,952.01"));

  const state = ledger();
  const left = diningLeftCents(state);
  expectEq("fixture dining left", left, 35_500);
  const before = JSON.stringify(state);

  const envelopes = payload(state, "get_envelopes", { category: "dining" });
  const envelopeRows = envelopes.envelopes as Array<{ id: string; remainingCents: number; spentCents: number; remaining: string; name: string }>;
  expectEq("dining envelope count", envelopeRows.length, 1);
  expectEq("dining remaining cents", envelopeRows[0]?.remainingCents, left);
  expectEq("dining spent cents", envelopeRows[0]?.spentCents, 4_500);
  expectEq("dining remaining dollars", envelopeRows[0]?.remaining, formatCents(left));
  expectEq("dining name", envelopeRows[0]?.name, "Restaurant / dining");

  const byName = payload(state, "get_envelopes", { category: "Restaurant / dining" }) as {
    envelopes: Array<{ id: string }>;
  };
  expectEq("category name resolves", byName.envelopes[0]?.id, "dining");

  const september = payload(state, "get_monthly_category_spend", { month: "2026-09", category: "dining" }) as {
    categories: Array<{ spentCents: number }>;
    totalSpentCents: number;
  };
  expectEq("september dining spend", september.categories[0]?.spentCents, 1_200);
  expectEq("september total is just dining", september.totalSpentCents, 1_200);

  const octoberSpend = payload(state, "get_monthly_category_spend", { month: "2026-10" }) as {
    categories: Array<{ id: string; spentCents: number }>;
    totalSpentCents: number;
  };
  expectEq(
    "october dining spend",
    octoberSpend.categories.find((row) => row.id === "dining")?.spentCents,
    4_500
  );
  expectEq(
    "october groceries spend",
    octoberSpend.categories.find((row) => row.id === "groceries")?.spentCents,
    8_000
  );
  expectEq("october total", octoberSpend.totalSpentCents, 12_500);

  const chipotle = payload(state, "get_transactions", { merchant: "chip", month: "2026-10" }) as {
    matchCount: number;
    transactions: Array<{ merchant: string }>;
  };
  expectEq("merchant filter count", chipotle.matchCount, 1);
  expectEq("merchant filter hit", chipotle.transactions[0]?.merchant, "Chipotle");

  const ranged = payload(state, "get_transactions", { from: "2026-10-03", to: "2026-10-03" }) as {
    transactions: Array<{ id: string }>;
  };
  expectEq("date range hit", ranged.transactions.map((row) => row.id).join(","), "jewel");

  const monthAndRange = payload(state, "get_transactions", {
    month: "2026-10",
    from: "2026-10-03",
    category: "dining",
  }) as { matchCount: number };
  expectEq("month and category intersection can be empty", monthAndRange.matchCount, 0);

  const many = ledger();
  many.expenses = Array.from({ length: 50 }, (_, index) =>
    expense({
      id: `misc-${index}`,
      amountCents: 100 + index,
      merchant: `Shop ${index}`,
      categoryId: "misc",
      date: "2026-10-01",
      createdAt: `2026-10-01T00:${String(index).padStart(2, "0")}:00.000Z`,
    })
  );
  const capped = payload(many, "get_transactions", { limit: 100, category: "misc" }) as {
    returned: number;
    matchCount: number;
    truncated: boolean;
    limit: number;
  };
  expectEq("limit clamps to the max", capped.returned, MAX_TRANSACTION_LIMIT);
  expectEq("limit reports the full match count", capped.matchCount, 50);
  expect("over-max limit truncates", capped.truncated);
  expectEq("applied limit", capped.limit, MAX_TRANSACTION_LIMIT);
  const defaults = payload(many, "get_transactions", { category: "misc" }) as { returned: number; limit: number };
  expectEq("default transaction limit", defaults.limit, DEFAULT_TRANSACTION_LIMIT);
  expectEq("default page size", defaults.returned, DEFAULT_TRANSACTION_LIMIT);

  const bills = payload(state, "get_bills", {}) as {
    bills: Array<{ name: string; fromThisCheck: boolean }>;
  };
  const amex = bills.bills.find((bill) => bill.name === "Amex");
  expect("amex is in the bill list", amex);
  expect("amex stays on the next paycheck", amex?.fromThisCheck === false);

  const checking = payload(state, "get_checking_balance", {}) as { checkingCents: number; checking: string };
  expectEq("checking cents", checking.checkingCents, 495_201);
  expectEq("checking dollars", checking.checking, formatCents(495_201));

  const badMonth = executeReadTool(state, "get_transactions", { month: "October" }, NOW);
  expect("bad month is an error", !badMonth.ok && /YYYY-MM/.test(badMonth.error));
  const badDate = executeReadTool(state, "get_transactions", { from: "2026-02-31" }, NOW);
  expect("impossible date is an error", !badDate.ok && /YYYY-MM-DD/.test(badDate.error));
  const backwards = executeReadTool(state, "get_transactions", { from: "2026-10-10", to: "2026-10-01" }, NOW);
  expect("backwards range is an error", !backwards.ok);
  const unknownCategory = executeReadTool(state, "get_envelopes", { category: "yacht" }, NOW);
  expect("unknown category is an error", !unknownCategory.ok);
  const unknownTool = executeReadTool(state, "erase_ledger", {}, NOW);
  expect("unknown tool is an error", !unknownTool.ok && /Reads only/.test(unknownTool.error));
  const badLimit = executeReadTool(state, "get_transactions", { limit: 0 }, NOW);
  expect("zero limit is an error", !badLimit.ok);
  expectEq("tools did not write the ledger", JSON.stringify(state), before);

  const root = process.cwd();
  const toolSource = readFileSync(path.join(root, "lib/assistant/tools.ts"), "utf8");
  const loopSource = readFileSync(path.join(root, "lib/assistant/loop.ts"), "utf8");
  expect("read tools do not import the store", !toolSource.includes("lib/store"));
  expect(
    "read tools do not write",
    !/saveState|updateState|logPurchase|saveBudget|saveChecking|saveBills|fetch\(/.test(toolSource)
  );
  expect("tool loop does not write the ledger", !/saveState|updateState|logPurchase/.test(loopSource));

  const box = harness(emptyAiUsage(), state);
  const firstUsage = sampleUsage({ inputTokens: 100, outputTokens: 20 });
  const secondUsage = sampleUsage({ inputTokens: 50, outputTokens: 30 });
  const logs = await withUsageLogs(async () => {
    const streamed = await box.run("how much dining is left?", async (args) => {
      if (box.calls.length === 1) {
        return {
          ...firstUsage,
          stopReason: "tool_use",
          toolUses: [{ type: "tool_use" as const, id: "toolu_dining", name: "get_envelopes", input: { category: "dining" } }],
        };
      }
      const result = toolResults(args.messages).find((block) => block.tool_use_id === "toolu_dining");
      if (!result || result.is_error) throw new Error("dining lookup did not return a tool result");
      const data = JSON.parse(result.content) as {
        envelopes: Array<{ id: string; name: string; remaining: string; remainingCents: number }>;
      };
      const dining = data.envelopes.find((row) => row.id === "dining");
      if (!dining) throw new Error("dining envelope missing");
      args.onText(`${dining.name} has ${dining.remaining} left this month.`);
      return { ...secondUsage, stopReason: "end_turn", toolUses: [] };
    });
    expectEq("dining question streams", streamed.status, 200);
    const body = await streamed.text();
    expectEq(
      "dining left answer",
      box.saved[0]?.reply,
      `Restaurant / dining has ${formatCents(left)} left this month.`
    );
    expect("streamed answer matches the ledger", body.includes(box.saved[0]?.reply ?? "missing"));
    expect("looking up status is streamed during the tool call", body.includes("\"looking_up\""));
    expect("stream does not leak the key", !body.includes(FAKE_KEY));
  });
  expectEq("model rounds", box.calls.length, 2);
  expectEq("usage log lines", logs.length, 2);
  const followUp = toolResults(box.calls[1]?.messages ?? []);
  const diningResult = followUp.find((block) => block.tool_use_id === "toolu_dining");
  expect("tool result present", diningResult);
  expect("successful tool is not is_error", diningResult?.is_error !== true);
  expect("tool result is outside the cache prefix", diningResult?.cache_control == null);
  const diningData = JSON.parse(diningResult?.content ?? "{}") as {
    envelopes: Array<{ remainingCents: number; spentCents: number }>;
  };
  expectEq("tool result remaining", diningData.envelopes[0]?.remainingCents, left);
  expectEq("tool result ignores september", diningData.envelopes[0]?.spentCents, 4_500);
  expectEq("both rounds share the cached tools", JSON.stringify(box.calls[0]?.tools), JSON.stringify(box.calls[1]?.tools));
  expectEq("system block stays cached", box.calls[0]?.system[0]?.cache_control.type, "ephemeral");
  const month = box.ledger().months["2026-10"];
  expectEq("each round counts as a request", month?.requests, 2);
  expectEq("input tokens from both rounds", month?.inputTokens, 150);
  expectEq("output tokens from both rounds", month?.outputTokens, 50);
  expectEq(
    "both rounds count toward the cap",
    month?.costMicroUsd,
    costMicroUsd(firstUsage, PRICE) + costMicroUsd(secondUsage, PRICE)
  );
  expect("dining lookup did not write", box.unchanged());

  const broken = harness(emptyAiUsage(), ledger());
  const invalid = await broken.run("show October dining charges", async () => {
    if (broken.calls.length === 1) {
      return {
        ...sampleUsage({ outputTokens: 5 }),
        stopReason: "tool_use",
        toolUses: [{ type: "tool_use" as const, id: "toolu_bad", name: "get_transactions", input: { month: "October" } }],
      };
    }
    const result = toolResults(broken.calls[1]?.messages ?? []).find((block) => block.tool_use_id === "toolu_bad");
    if (!result?.is_error) throw new Error("expected is_error");
    return { ...sampleUsage({ outputTokens: 5 }), stopReason: "end_turn", toolUses: [] };
  });
  await invalid.text();
  const invalidResult = toolResults(broken.calls[1]?.messages ?? []).find((block) => block.tool_use_id === "toolu_bad");
  expect("invalid tool input sets is_error", invalidResult?.is_error === true);
  expect("invalid tool input stays short", (invalidResult?.content.length ?? 999) < 80 && /YYYY-MM/.test(invalidResult?.content ?? ""));

  const denied = harness(emptyAiUsage(), ledger());
  const deniedRes = await denied.run("delete the dining charges", async (args) => {
    if (denied.calls.length === 1) {
      return {
        ...sampleUsage({ outputTokens: 5 }),
        stopReason: "tool_use",
        toolUses: [{ type: "tool_use" as const, id: "toolu_write", name: "erase_ledger", input: {} }],
      };
    }
    args.onText("I can't make edits yet.");
    return { ...sampleUsage({ outputTokens: 8 }), stopReason: "end_turn", toolUses: [] };
  });
  await deniedRes.text();
  const deniedResult = toolResults(denied.calls[1]?.messages ?? []).find((block) => block.tool_use_id === "toolu_write");
  expect("unknown write tool sets is_error", deniedResult?.is_error === true);
  expect("write refusal is short", deniedResult?.content === "That tool is not available. Reads only.");
  expect("write attempt did not change the ledger", denied.unchanged());

  const exploding = harness(emptyAiUsage(), ledger());
  const exploded = await exploding.run("how much dining is left?", async (args) => {
    if (exploding.calls.length === 1) {
      return {
        ...sampleUsage({ outputTokens: 5 }),
        stopReason: "tool_use",
        toolUses: [{ type: "tool_use" as const, id: "toolu_boom", name: "get_envelopes", input: { category: "dining" } }],
      };
    }
    const result = toolResults(args.messages).find((block) => block.tool_use_id === "toolu_boom");
    if (result?.content !== "That lookup failed." || result.is_error !== true) {
      throw new Error(`expected a short tool error, got ${JSON.stringify(result)}`);
    }
    args.onText("I couldn't read that.");
    return { ...sampleUsage({ outputTokens: 4 }), stopReason: "end_turn", toolUses: [] };
  }, {
    executeTool: () => {
      throw new Error("disk failed: secret path");
    },
  });
  const explodedBody = await exploded.text();
  expect("thrown tool text is not leaked", !explodedBody.includes("disk failed") && !explodedBody.includes("secret path"));
  expectEq("thrown tool still answers", exploding.saved[0]?.reply, "I couldn't read that.");

  let executions = 0;
  const spinning = harness(emptyAiUsage(), ledger());
  const spinLogs = await withUsageLogs(async () => {
    const spun = await spinning.run("keep looking", async () => {
      return {
        ...sampleUsage({ inputTokens: 10, outputTokens: 1 }),
        stopReason: "tool_use",
        toolUses: [{ type: "tool_use" as const, id: `toolu_${spinning.calls.length}`, name: "get_checking_balance", input: {} }],
      };
    }, {
      executeTool: (current, name, input, now) => {
        executions += 1;
        return executeReadTool(current, name, input, now);
      },
    });
    const spunBody = await spun.text();
    expect("iteration cap explains the stop", spunBody.includes(TOOL_LOOP_LIMIT_MESSAGE));
    expectEq("iteration cap reply", spinning.saved[0]?.reply, TOOL_LOOP_LIMIT_MESSAGE);
  });
  expectEq("iteration cap model calls", spinning.calls.length, MAX_TOOL_ROUNDS);
  expectEq("iteration cap does not start another round", executions, MAX_TOOL_ROUNDS - 1);
  expectEq("iteration cap bills every round", spinning.ledger().months["2026-10"]?.requests, MAX_TOOL_ROUNDS);
  expectEq("iteration cap logs every round", spinLogs.length, MAX_TOOL_ROUNDS);

  const almostCapped = harness(
    {
      ...emptyAiUsage(),
      months: { "2026-10": { ...emptyMonth(), costMicroUsd: 10_000_000 - 1 } },
    },
    ledger()
  );
  const expensive = sampleUsage({ inputTokens: 1_000 });
  const cappedRes = await almostCapped.run("how much dining is left?", async (args) => {
    if (almostCapped.calls.length > 1) {
      args.onText("should not run");
    }
    return {
      ...expensive,
      stopReason: "tool_use",
      toolUses: [{ type: "tool_use" as const, id: "toolu_cap", name: "get_envelopes", input: { category: "dining" } }],
    };
  });
  const cappedBody = await cappedRes.text();
  expectEq("cap stops the next round trip", almostCapped.calls.length, 1);
  expect("cap message is streamed", /used up/i.test(cappedBody));
  expectEq("cap message is sent once", cappedBody.split("used up").length - 1, 1);
  expect("over-cap round does not run", !cappedBody.includes("should not run"));
  const cappedMonth = almostCapped.ledger().months["2026-10"];
  expectEq("only the completed round is billed", cappedMonth?.requests, 1);
  expectEq(
    "completed round still counts toward the cap",
    cappedMonth?.costMicroUsd,
    10_000_000 - 1 + costMicroUsd(expensive, PRICE)
  );
  expect(
    "recorded spend is what the cap check would see",
    (cappedMonth?.costMicroUsd ?? 0) >= 10_000_000
  );

  console.log("assistant tools ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
