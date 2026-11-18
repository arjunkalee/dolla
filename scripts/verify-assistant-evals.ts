/**
 * Offline eval for assistant prompt changes.
 * Fixed prompts, a mocked Messages API, and checks for tool choice plus answer properties.
 * Run before merging prompt changes: npm run test:assistant-evals
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createSessionToken } from "../lib/auth";
import type { AssistantStreamCall } from "../lib/assistant/handle";
import { handleAssistantRequest } from "../lib/assistant/handle";
import {
  applyMemoryTool,
  deleteMemoryFact,
  emptyMemory,
  factFromStatement,
  foldConversationSummary,
  forgetFact,
  isSafeFact,
  persistAssistantMemory,
  readAssistantMemory,
  rememberFact,
  withMemoryTools,
  type AssistantMemory,
} from "../lib/assistant/memory";
import type { AssistantRound } from "../lib/assistant/loop";
import type { ModelMessage } from "../lib/assistant/messages";
import { emptyMonth, monthSpendFromLedger } from "../lib/assistant/usage";
import { ASSISTANT_SYSTEM_PROMPT, cachedSystemPrompt } from "../lib/assistant/prompt";
import { SUGGESTED_PROMPTS } from "../lib/assistant/suggestions";
import { cachedAssistantTools } from "../lib/assistant/tools";
import { toolsForApiCall } from "../lib/assistant/web-search";
import { formatCents } from "../lib/money";
import { realState } from "../lib/seed";
import type { AppState, ChatMessage } from "../lib/types";
import type { TokenUsage } from "../lib/assistant/pricing";

function expect(label: string, cond: unknown, detail = "") {
  if (!cond) throw new Error(detail ? `${label}: ${detail}` : label);
}

function expectEq(label: string, got: unknown, want: unknown) {
  if (got !== want) throw new Error(`${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

const NOW = new Date("2026-10-15T18:00:00.000Z");
const FAKE_KEY = "test-not-a-real-key";
const INVENTED = "$8,888.88";

function sampleUsage(): TokenUsage {
  return {
    inputTokens: 10,
    outputTokens: 5,
    cacheCreation5mTokens: 0,
    cacheCreation1hTokens: 0,
    cacheReadTokens: 0,
    webSearchRequests: 0,
  };
}

function toolRound(name: string, input: unknown): AssistantRound {
  return {
    ...sampleUsage(),
    stopReason: "tool_use",
    toolUses: [{ type: "tool_use", id: "toolu_eval", name, input }],
  };
}

function textRound(args: AssistantStreamCall, text: string): AssistantRound {
  args.onText(text);
  return { ...sampleUsage(), stopReason: "end_turn", toolUses: [] };
}

function dollarsIn(text: string): string[] {
  return text.match(/\$\s?\d[\d,]*(?:\.\d+)?/g) ?? [];
}

function assertCitedDollars(label: string, reply: string, allowed: string) {
  expect(label, !reply.includes(INVENTED), `invented ${INVENTED}`);
  for (const amount of dollarsIn(reply)) {
    expect(label, allowed.includes(amount), `cites ${amount} which is not in the tool result`);
  }
}

function lastToolUse(messages: readonly ModelMessage[]): { name: string } | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const content = messages[index]?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const record = block as { type?: string; name?: string };
      if (record.type === "tool_use" && typeof record.name === "string") return { name: record.name };
    }
  }
  return null;
}

function lastToolResult(messages: readonly ModelMessage[]): { content: string; isError: boolean } | null {
  const last = messages.at(-1);
  if (!last || !Array.isArray(last.content)) return null;
  for (const block of [...last.content].reverse()) {
    if (!block || typeof block !== "object") continue;
    const record = block as { type?: string; content?: string; is_error?: boolean };
    if (record.type === "tool_result" && typeof record.content === "string") {
      return { content: record.content, isError: record.is_error === true };
    }
  }
  return null;
}

type MemoryBox = { current: AssistantMemory };

async function runPrompt(options: {
  prompt: string;
  state: AppState;
  memory: MemoryBox;
  respond: (args: AssistantStreamCall, round: number) => AssistantRound | Promise<AssistantRound>;
}) {
  const calls: AssistantStreamCall[] = [];
  const saved: string[] = [];
  const before = JSON.stringify(options.state);
  let ledger = {
    months: {},
    recentRequestAt: [] as number[],
  };
  const logs: string[] = [];
  const originalInfo = console.info;
  const originalError = console.error;
  console.info = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
  };
  console.error = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
  };
  try {
    const res = await handleAssistantRequest({
      sessionToken: await createSessionToken(),
      text: options.prompt,
      now: NOW,
      env: { ANTHROPIC_API_KEY: FAKE_KEY, DOLLA_AI_MONTHLY_CAP_USD: "10" },
      loadLedger: async () => options.state,
      mutateUsage: async (mutator) => {
        ledger = mutator(ledger);
        return structuredClone(ledger);
      },
      appendExchange: async (_user, reply) => {
        saved.push(reply);
      },
      loadMemory: async () => structuredClone(options.memory.current),
      saveMemory: async (next) => {
        options.memory.current = structuredClone(next);
      },
      streamReply: async (args) => {
        calls.push({
          ...args,
          messages: structuredClone(args.messages),
          system: structuredClone(args.system),
        });
        return options.respond(args, calls.length);
      },
    });
    expectEq(`${options.prompt} status`, res.status, 200);
    const body = await res.text();
    return {
      body,
      calls,
      saved,
      logs,
      unchanged: JSON.stringify(options.state) === before,
    };
  } finally {
    console.info = originalInfo;
    console.error = originalError;
  }
}

function assertNoSecrets(label: string, logs: string[]) {
  const blob = logs.join("\n");
  expect(label, !blob.includes(FAKE_KEY), "logged the api key");
  expect(label, !blob.includes("sk-ant-"), "logged an api key");
  expect(label, !/\bpin\b\s*[:=]?\s*\d{4}/i.test(blob), "logged a pin");
}

function envelopeSentence(data: unknown): string {
  const row = data as { envelopes: Array<{ id: string; name: string; remaining: string }> };
  const envelope = row.envelopes[0];
  if (!envelope) throw new Error("envelope missing");
  return `${envelope.name} has ${envelope.remaining} left.`;
}

function spendSentence(data: unknown): string {
  const row = data as { categories: Array<{ name: string; spent: string }> };
  const category = row.categories[0];
  if (!category) throw new Error("category missing");
  return `${category.name} spent ${category.spent} this month.`;
}

function checkingSentence(data: unknown): string {
  const row = data as { checking: string };
  return `Checking is ${row.checking}.`;
}

function billsSentence(data: unknown): string {
  const row = data as { bills: Array<{ name: string; paid: boolean }> };
  const unpaid = row.bills.filter((bill) => !bill.paid).map((bill) => bill.name);
  return unpaid.length ? `Unpaid: ${unpaid.join(", ")}.` : "No unpaid bills.";
}

const CLIENT_CASES: Array<{
  prompt: string;
  tool: string;
  input: Record<string, unknown>;
  sentence: (data: unknown) => string;
  promptCue: RegExp;
}> = [
  {
    prompt: "How much is left for dining?",
    tool: "get_envelopes",
    input: { category: "dining" },
    sentence: envelopeSentence,
    promptCue: /get_envelopes/,
  },
  {
    prompt: "What's my checking balance?",
    tool: "get_checking_balance",
    input: {},
    sentence: checkingSentence,
    promptCue: /get_checking_balance/,
  },
  {
    prompt: "Which bills are still unpaid?",
    tool: "get_bills",
    input: {},
    sentence: billsSentence,
    promptCue: /get_bills/,
  },
  {
    prompt: "What did I spend on groceries this month?",
    tool: "get_monthly_category_spend",
    input: { category: "groceries" },
    sentence: spendSentence,
    promptCue: /get_monthly_category_spend/,
  },
];

function longHistory(): ChatMessage[] {
  const messages: ChatMessage[] = [
    {
      id: "old-user",
      role: "user",
      text: "legacy-payday-note was $12.00",
      createdAt: NOW.toISOString(),
    },
    {
      id: "old-dolla",
      role: "dolla",
      text: "Dining left is $12.00.",
      createdAt: NOW.toISOString(),
    },
  ];
  for (let index = 0; index < 11; index++) {
    messages.push(
      {
        id: `u-${index}`,
        role: "user",
        text: index === 10 ? "recent-envelope-topic" : `filler-user-${index}`,
        createdAt: NOW.toISOString(),
      },
      {
        id: `d-${index}`,
        role: "dolla",
        text: `filler-dolla-${index}`,
        createdAt: NOW.toISOString(),
      }
    );
  }
  return messages;
}

async function main() {
  expectEq("payday fact", factFromStatement("I get paid on Fridays"), "I get paid on Fridays");
  expectEq(
    "remember prefix",
    factFromStatement("Remember that I get paid on Fridays."),
    "I get paid on Fridays"
  );
  expect("question is not a fact", factFromStatement("How much is left for dining?") === null);
  expect("pin is not a fact", factFromStatement("remember my pin is 2468") === null);
  expect("api key is not a fact", factFromStatement("remember sk-ant-api03-abcdefghij") === null);
  expect("dollar fact is refused", !isSafeFact("I get paid $2771 on Fridays"));
  expectEq(
    "duplicate fact",
    rememberFact(
      rememberFact(emptyMemory(), "I get paid on Fridays", NOW.toISOString()),
      "I get paid on Fridays",
      NOW.toISOString()
    ).facts.length,
    1
  );

  const folded = foldConversationSummary(emptyMemory(), longHistory());
  expect("summary keeps the topic", folded.summary.includes("legacy-payday-note"));
  expect("summary strips the old dollar", !folded.summary.includes("$"));
  expect("summary marks the amount", folded.summary.includes("[amount]"));
  expect("summary skips the recent line", !folded.summary.includes("recent-envelope-topic"));

  const spend = monthSpendFromLedger(
    {
      months: { "2026-10": { ...emptyMonth(), costMicroUsd: 1_250_000, requests: 4 } },
      recentRequestAt: [],
    },
    NOW,
    { DOLLA_AI_MONTHLY_CAP_USD: "10" }
  );
  expectEq("month spend", spend.monthSpendUsd, 1.25);
  expectEq("cap", spend.capUsd, 10);
  expectEq("requests", spend.requests, 4);
  expectEq("last reset", spend.resetOn, "2026-10-01");
  expectEq("empty month still has a reset date", monthSpendFromLedger({ months: {}, recentRequestAt: [] }, NOW, {}).resetOn, "2026-10-01");
  expectEq("empty month request count", monthSpendFromLedger({ months: {}, recentRequestAt: [] }, NOW, {}).requests, 0);

  const baseTools = cachedAssistantTools();
  const wrapped = withMemoryTools(baseTools);
  expectEq("cache breakpoint stays on the last tool", wrapped.at(-1)?.name, baseTools.at(-1)?.name);
  expectEq("last tool still cached", wrapped.at(-1)?.cache_control?.type, "ephemeral");
  const wrappedNames = wrapped.map((tool) => String(tool.name));
  expect("remember tool is available", wrappedNames.includes("remember_fact"));
  expect(
    "memory tools sit before the cache breakpoint",
    wrapped
      .filter((tool) => {
        const name = String(tool.name);
        return name === "remember_fact" || name === "forget_fact";
      })
      .every((tool) => tool.cache_control == null)
  );

  const blocks = cachedSystemPrompt(["I get paid on Fridays"]);
  expectEq("standing prompt stays the first cached block", blocks[0]?.text, ASSISTANT_SYSTEM_PROMPT);
  expectEq("memory block is cached", blocks[1]?.cache_control.type, "ephemeral");
  expect("memory block lists the fact", blocks[1]?.text.includes("I get paid on Fridays"));
  expect("memory block does not invent a balance", !blocks[1]?.text.includes("$"));
  expect("empty memory still teaches remember_fact", cachedSystemPrompt()[1]?.text.includes("remember_fact"));

  for (const prompt of SUGGESTED_PROMPTS) {
    const covered =
      CLIENT_CASES.some((item) => item.prompt === prompt.text) || prompt.text.includes("savings rates");
    expect(`eval covers ${prompt.label}`, covered);
  }

  const state = realState(NOW);
  const checking = formatCents(state.checkingCents);

  for (const item of CLIENT_CASES) {
    expect(`prompt still names ${item.tool}`, item.promptCue.test(ASSISTANT_SYSTEM_PROMPT));
    const memory: MemoryBox = { current: emptyMemory() };
    const result = await runPrompt({
      prompt: item.prompt,
      state,
      memory,
      respond: (args, round) => {
        if (round === 1) return toolRound(item.tool, item.input);
        const toolResult = lastToolResult(args.messages);
        if (!toolResult || toolResult.isError) throw new Error(`${item.prompt} tool failed: ${toolResult?.content}`);
        const data = JSON.parse(toolResult.content) as unknown;
        return textRound(args, item.sentence(data));
      },
    });
    expectEq(`${item.tool} rounds`, result.calls.length, 2);
    expectEq(`${item.tool} choice`, lastToolUse(result.calls[1]!.messages)?.name, item.tool);
    expect(`${item.tool} was offered`, result.calls[0]!.tools.some((tool) => tool.name === item.tool));
    const toolResult = lastToolResult(result.calls[1]!.messages);
    const reply = result.saved[0] ?? "";
    expectEq(`${item.prompt} answer`, reply, item.sentence(JSON.parse(toolResult?.content ?? "{}")));
    assertCitedDollars(item.prompt, reply, toolResult?.content ?? "");
    if (item.tool !== "get_checking_balance") {
      expect(`${item.prompt} does not substitute checking`, !reply.includes(checking));
    } else {
      expect(`${item.prompt} uses the ledger checking balance`, reply.includes(checking));
    }
    expect(`${item.prompt} did not write the ledger`, result.unchanged);
    assertNoSecrets(item.prompt, result.logs);
    expectEq("standing prompt unchanged", result.calls[0]?.system[0]?.text, ASSISTANT_SYSTEM_PROMPT);
  }

  const rates = await runPrompt({
    prompt: "What are today's high-yield savings rates?",
    state,
    memory: { current: emptyMemory() },
    respond: (args) =>
      textRound(
        args,
        "From the web, Bankrate publishes high-yield savings rates. This is general information, not a balance."
      ),
  });
  expectEq("rates stay one round", rates.calls.length, 1);
  expect("rates offer web_search", toolsForApiCall(rates.calls[0]!.tools).some((tool) => tool.name === "web_search"));
  expect("prompt still tells it when to search", /web_search/.test(ASSISTANT_SYSTEM_PROMPT));
  expect("rates answer names the web", /from the web/i.test(rates.saved[0] ?? ""));
  assertCitedDollars("rates", rates.saved[0] ?? "", "");
  expect("rates do not invent checking", !(rates.saved[0] ?? "").includes(checking));

  const yacht = await runPrompt({
    prompt: "How much is left in the yacht envelope?",
    state,
    memory: { current: emptyMemory() },
    respond: (args, round) => {
      if (round === 1) return toolRound("get_envelopes", { category: "yacht" });
      const toolResult = lastToolResult(args.messages);
      if (!toolResult?.isError) throw new Error("yacht lookup should fail");
      return textRound(args, "I don't have that figure.");
    },
  });
  expect("unknown envelope is an error", lastToolResult(yacht.calls[1]!.messages)?.isError === true);
  expectEq("unknown envelope choice", lastToolUse(yacht.calls[1]!.messages)?.name, "get_envelopes");
  assertCitedDollars("yacht", yacht.saved[0] ?? "", "");

  const refused = await runPrompt({
    prompt: "Please move money from dining into travel",
    state,
    memory: { current: emptyMemory() },
    respond: (args) => textRound(args, "I can't make edits yet."),
  });
  expectEq("edit refusal rounds", refused.calls.length, 1);
  expect("edit refusal", /can.?t make edits yet/i.test(refused.saved[0] ?? ""));
  assertCitedDollars("edit refusal", refused.saved[0] ?? "", "");
  expect("edit refusal did not write", refused.unchanged);

  const memory: MemoryBox = { current: emptyMemory() };
  const remembered = await runPrompt({
    prompt: "I get paid on Fridays",
    state,
    memory,
    respond: (args) => textRound(args, "I'll remember that you get paid on Fridays."),
  });
  expectEq("fact stored", memory.current.facts[0]?.text, "I get paid on Fridays");
  expect("fact is in the cached memory block", remembered.calls[0]?.system[1]?.text.includes("I get paid on Fridays"));
  expect("memory block has no dollars", !remembered.calls[0]?.system[1]?.text.includes("$"));
  assertCitedDollars("remember", remembered.saved[0] ?? "", "");
  expect("remember did not write the ledger", remembered.unchanged);

  const recalled = await runPrompt({
    prompt: "When do I get paid?",
    state,
    memory,
    respond: (args) => textRound(args, "You get paid on Fridays."),
  });
  expect("recall sees the fact", recalled.calls[0]?.system[1]?.text.includes("I get paid on Fridays"));
  assertCitedDollars("recall", recalled.saved[0] ?? "", "");

  const quiet: MemoryBox = { current: emptyMemory() };
  const viaTool = await runPrompt({
    prompt: "Sundays are my quiet day",
    state,
    memory: quiet,
    respond: (args, round) => {
      if (round === 1) return toolRound("remember_fact", { text: "Sundays are my quiet day" });
      const toolResult = lastToolResult(args.messages);
      if (!toolResult || toolResult.isError) throw new Error(toolResult?.content ?? "remember failed");
      return textRound(args, "I'll remember Sundays are your quiet day.");
    },
  });
  expectEq("remember_fact choice", lastToolUse(viaTool.calls[1]!.messages)?.name, "remember_fact");
  expectEq("tool saved the fact", quiet.current.facts[0]?.text, "Sundays are my quiet day");
  assertCitedDollars("quiet day", viaTool.saved[0] ?? "", "");

  const forgotten = await runPrompt({
    prompt: "Forget that I get paid on Fridays",
    state,
    memory,
    respond: (args, round) => {
      if (round === 1) return toolRound("forget_fact", { text: "Fridays" });
      const toolResult = lastToolResult(args.messages);
      if (!toolResult || toolResult.isError) throw new Error(toolResult?.content ?? "forget failed");
      return textRound(args, "Forgot that.");
    },
  });
  expectEq("forget_fact choice", lastToolUse(forgotten.calls[1]!.messages)?.name, "forget_fact");
  expect("friday fact deleted", memory.current.facts.every((fact) => !/fridays/i.test(fact.text)));
  assertCitedDollars("forget", forgotten.saved[0] ?? "", "");

  const summaryState = realState(NOW);
  summaryState.chatMessages = longHistory();
  const summaryMemory: MemoryBox = { current: emptyMemory() };
  const summarized = await runPrompt({
    prompt: "How much is left for dining?",
    state: summaryState,
    memory: summaryMemory,
    respond: (args, round) => {
      if (round === 1) return toolRound("get_envelopes", { category: "dining" });
      const toolResult = lastToolResult(args.messages);
      if (!toolResult || toolResult.isError) throw new Error("summary dining lookup failed");
      return textRound(args, envelopeSentence(JSON.parse(toolResult.content)));
    },
  });
  const prior = summarized.calls[0]!.messages.slice(0, -1);
  const priorText = prior.map((message) => (typeof message.content === "string" ? message.content : "")).join("\n");
  const latest = String(summarized.calls[0]!.messages.at(-1)?.content ?? "");
  expect("recent messages stay verbatim", priorText.includes("recent-envelope-topic"));
  expect("old dollar stays out of recent messages", !priorText.includes("$12.00") && !priorText.includes("legacy-payday-note"));
  expect("summary is on the newest turn", latest.includes("legacy-payday-note") && latest.includes("Earlier conversation"));
  expect("summary on the turn has no old dollar", !latest.includes("$12.00"));
  expect("saved summary has no dollar sign", !summaryMemory.current.summary.includes("$"));
  assertCitedDollars("summary dining", summarized.saved[0] ?? "", lastToolResult(summarized.calls[1]!.messages)?.content ?? "");

  const unsafe = applyMemoryTool(emptyMemory(), "remember_fact", { text: "the balance is $10" }, NOW.toISOString());
  expect("tool rejects a dollar fact", !unsafe.outcome.ok);
  const dropped = forgetFact(
    rememberFact(emptyMemory(), "I get paid on Fridays", NOW.toISOString()),
    { text: "paid" }
  );
  expectEq("forget by text", dropped.facts.length, 0);

  await persistAssistantMemory(
    rememberFact(
      { ...emptyMemory(), summary: "He said: legacy-payday-note was [amount]." },
      "I get paid on Fridays",
      NOW.toISOString()
    )
  );
  const stored = await readAssistantMemory();
  expectEq("durable fact", stored.facts[0]?.text, "I get paid on Fridays");
  expect("durable summary", stored.summary.includes("legacy-payday-note"));
  const cleared = await deleteMemoryFact(stored.facts[0]!.id);
  expectEq("deleted fact", cleared.facts.length, 0);
  const reread = await readAssistantMemory();
  expectEq("delete stuck", reread.facts.length, 0);

  const root = process.cwd();
  const chat = readFileSync(path.join(root, "components/chat-screen.tsx"), "utf8");
  const panel = readFileSync(path.join(root, "components/assistant-panel.tsx"), "utf8");
  const route = readFileSync(path.join(root, "app/api/assistant/memory/route.ts"), "utf8");
  expect("chat renders suggested prompts", chat.includes("SuggestedPrompts"));
  expect("profile shows requests", panel.includes("requests"));
  expect("profile shows the reset date", panel.includes("resetOn"));
  expect("memory route checks the session", route.includes("sessionValid"));
  expect("memory route does not log a key", !route.includes("console."));

  console.log("assistant evals ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
