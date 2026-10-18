import { readFileSync } from "node:fs";
import path from "node:path";
import { createSessionToken } from "../lib/auth";
import type { AssistantStreamCall } from "../lib/assistant/handle";
import { handleAssistantRequest } from "../lib/assistant/handle";
import { buildModelMessages } from "../lib/assistant/messages";
import { HISTORY_LIMIT, MAX_OUTPUT_TOKENS, modelCallOptions, resolveAssistantModel } from "../lib/assistant/models";
import {
  costMicroUsd,
  priceForModel,
  usageFromAnthropic,
  type TokenUsage,
} from "../lib/assistant/pricing";
import { ASSISTANT_SYSTEM_PROMPT } from "../lib/assistant/prompt";
import {
  addRequestUsage,
  capReached,
  emptyAiUsage,
  emptyMonth,
  monthlyCapMicroUsd,
  reserveRequest,
  usageMonthKey,
  type AiUsageLedger,
} from "../lib/assistant/usage";
import { parseChat } from "../lib/chat";
import { realState } from "../lib/seed";
import type { AppState, ChatMessage } from "../lib/types";

function expect(label: string, cond: unknown, detail = "") {
  if (!cond) throw new Error(detail ? `${label}: ${detail}` : label);
}

function expectEq(label: string, got: unknown, want: unknown) {
  if (got !== want) throw new Error(`${label}: got ${String(got)}, want ${String(want)}`);
}

const NOW = new Date("2026-10-15T18:00:00.000Z");
const FAKE_KEY = "test-not-a-real-key";

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

function history(count: number): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (let i = 0; i < count; i++) {
    messages.push(
      { id: `u-${i}`, role: "user", text: `user-${i}`, createdAt: NOW.toISOString() },
      { id: `d-${i}`, role: "dolla", text: `dolla-${i}`, createdAt: NOW.toISOString() }
    );
  }
  return messages;
}

function harness(start?: AiUsageLedger) {
  let ledger = start ?? emptyAiUsage();
  const calls: AssistantStreamCall[] = [];
  const saved: Array<{ user: string; reply: string }> = [];
  let usageWrites = 0;
  const state: AppState = realState(NOW);
  state.bills = [
    ...state.bills,
    {
      id: "snap",
      name: "SnapshotOnlyCafe",
      amountCents: 1234,
      dueDate: "2026-10-20",
      paid: false,
      kind: "other",
      fromThisCheck: false,
    },
  ];
  state.chatMessages = history(25);

  async function run(
    text: string,
    options?: {
      now?: Date;
      token?: string | null;
      env?: Record<string, string | undefined>;
    }
  ) {
    return handleAssistantRequest({
      sessionToken: options && "token" in options ? options.token : await createSessionToken(),
      text,
      now: options?.now ?? NOW,
      env: options?.env ?? {
        ANTHROPIC_API_KEY: FAKE_KEY,
        DOLLA_AI_MONTHLY_CAP_USD: "10",
      },
      loadLedger: async () => state,
      mutateUsage: async (mutator) => {
        usageWrites += 1;
        ledger = mutator(ledger);
        return structuredClone(ledger);
      },
      appendExchange: async (user, reply) => {
        saved.push({ user, reply });
      },
      streamReply: async (args) => {
        calls.push(args);
        args.onText("Dining has ");
        args.onText("$12 left.");
        return sampleUsage({
          inputTokens: 1_000,
          outputTokens: 100,
          cacheCreation5mTokens: 20,
          cacheReadTokens: 10,
        });
      },
    });
  }

  return {
    run,
    calls,
    saved,
    ledger: () => ledger,
    usageWrites: () => usageWrites,
  };
}

async function main() {
  const sonnet55 = priceForModel("claude-sonnet-5-5");
  expectEq(
    "1M input tokens",
    costMicroUsd(sampleUsage({ inputTokens: 1_000_000 }), sonnet55),
    2_000_000
  );
  expectEq(
    "1M output tokens",
    costMicroUsd(sampleUsage({ outputTokens: 1_000_000 }), sonnet55),
    10_000_000
  );
  expectEq(
    "1M 5m cache write",
    costMicroUsd(sampleUsage({ cacheCreation5mTokens: 1_000_000 }), sonnet55),
    2_500_000
  );
  expectEq(
    "1M 1h cache write",
    costMicroUsd(sampleUsage({ cacheCreation1hTokens: 1_000_000 }), sonnet55),
    4_000_000
  );
  expectEq(
    "1M cache read",
    costMicroUsd(sampleUsage({ cacheReadTokens: 1_000_000 }), sonnet55),
    100_000
  );
  expect(
    "cache read is cheaper than input",
    costMicroUsd(sampleUsage({ cacheReadTokens: 1_000_000 }), sonnet55) <
      costMicroUsd(sampleUsage({ inputTokens: 1_000_000 }), sonnet55)
  );
  expectEq(
    "mixed sonnet 5.5 request",
    costMicroUsd(
      sampleUsage({
        inputTokens: 1_000,
        outputTokens: 100,
        cacheCreation5mTokens: 20,
        cacheReadTokens: 10,
      }),
      sonnet55
    ),
    3_051
  );
  expectEq(
    "fractional micro rounds up",
    costMicroUsd(sampleUsage({ cacheReadTokens: 1 }), sonnet55),
    1
  );
  expectEq(
    "unknown model uses the higher fallback",
    costMicroUsd(sampleUsage({ inputTokens: 1_000_000 }), priceForModel("claude-custom")),
    3_000_000
  );

  const split = usageFromAnthropic({
    input_tokens: 12,
    output_tokens: 4,
    cache_creation_input_tokens: 99,
    cache_read_input_tokens: 7,
    cache_creation: { ephemeral_5m_input_tokens: 30, ephemeral_1h_input_tokens: 2 },
  });
  expectEq("5m cache tokens", split.cacheCreation5mTokens, 30);
  expectEq("1h cache tokens", split.cacheCreation1hTokens, 2);
  expectEq("uncached input stays separate", split.inputTokens, 12);
  expectEq("cache read tokens", split.cacheReadTokens, 7);

  expectEq("default cap is $10", monthlyCapMicroUsd({}), 10_000_000);
  expectEq("cap env override", monthlyCapMicroUsd({ DOLLA_AI_MONTHLY_CAP_USD: "2" }), 2_000_000);
  expectEq("bad cap falls back to $10", monthlyCapMicroUsd({ DOLLA_AI_MONTHLY_CAP_USD: "nope" }), 10_000_000);
  expect("at cap", capReached(10_000_000, 10_000_000));
  expect("over cap", capReached(10_000_001, 10_000_000));
  expect("under cap", !capReached(9_999_999, 10_000_000));

  expectEq(
    "chicago month before midnight",
    usageMonthKey(new Date("2026-10-01T04:30:00.000Z")),
    "2026-09"
  );
  expectEq(
    "chicago month after midnight",
    usageMonthKey(new Date("2026-10-01T05:30:00.000Z")),
    "2026-10"
  );

  expectEq("default model", resolveAssistantModel({}), "claude-sonnet-5-5");
  expectEq("model override", resolveAssistantModel({ DOLLA_AI_MODEL: "claude-sonnet-4-6" }), "claude-sonnet-4-6");
  expectEq("sonnet 5.5 skips up-front thinking", modelCallOptions("claude-sonnet-5-5").thinking?.type, "between_tools");
  expect("older override omits thinking", modelCallOptions("claude-sonnet-4-6").thinking === undefined);

  const trimmed = buildModelMessages(history(25), "SNAPSHOT", "how much is left?");
  expect(
    "history trimmed to about 20",
    trimmed.length <= HISTORY_LIMIT + 1,
    `history length ${trimmed.length}`
  );
  expectEq("history ends with the question", trimmed[trimmed.length - 1]?.role, "user");
  expect("snapshot is on the user turn", trimmed[trimmed.length - 1]?.content.includes("SNAPSHOT"));
  expect(
    "user turn says to cite a tool",
    trimmed[trimmed.length - 1]?.content.includes("call a tool")
  );
  expect("question is on the user turn", trimmed[trimmed.length - 1]?.content.includes("how much is left?"));
  expect(
    "oldest turn was trimmed",
    trimmed.every((turn) => !turn.content.includes("user-0") && !turn.content.includes("dolla-0"))
  );

  expect("prompt tools are read only", /tools only read/i.test(ASSISTANT_SYSTEM_PROMPT));
  expect(
    "prompt requires a tool before quoting dollars",
    /call the matching tool before you answer/i.test(ASSISTANT_SYSTEM_PROMPT)
  );
  expect("prompt does not quote the context block", /Do not quote a dollar amount from the context block/.test(ASSISTANT_SYSTEM_PROMPT));
  expect("prompt refuses edits", /can.?t make edits yet/i.test(ASSISTANT_SYSTEM_PROMPT));
  expect("prompt explains invest leftover", /take-home minus the sum of the envelopes/i.test(ASSISTANT_SYSTEM_PROMPT));
  expect("prompt explains past-due", /treated as paid/i.test(ASSISTANT_SYSTEM_PROMPT));
  expect("prompt keeps calendar calendar-only", /Calendar tab is calendar-only/i.test(ASSISTANT_SYSTEM_PROMPT));
  expect("prompt has no live checking balance", !ASSISTANT_SYSTEM_PROMPT.includes("4,952.01"));

  const ledgerState = realState(NOW);
  expectEq("log command still parses", parseChat("log $10 dining", ledgerState).type, "log-expense");
  expectEq(
    "a question is not a command",
    parseChat("how much is left for dining?", ledgerState).type,
    "unknown"
  );

  const missing = harness();
  const locked = await missing.run("how much is left?", { token: null });
  expectEq("missing session is 401", locked.status, 401);
  expectEq("locked body", (await locked.json()).error, "Locked");
  expectEq("locked does not call the model", missing.calls.length, 0);
  expectEq("locked does not write usage", missing.usageWrites(), 0);

  const bad = harness();
  const rejected = await bad.run("how much is left?", { token: "not-a-session" });
  expectEq("bad session is 401", rejected.status, 401);
  expectEq("bad session does not call the model", bad.calls.length, 0);

  const unconfigured = harness();
  const off = await unconfigured.run("how much is left?", {
    token: await createSessionToken(),
    env: { DOLLA_AI_MONTHLY_CAP_USD: "10" },
  });
  expectEq("missing key is 503", off.status, 503);
  const offBody = await off.json();
  expect("503 names the env var", String(offBody.error).includes("ANTHROPIC_API_KEY"));
  expect("503 does not include a key", !JSON.stringify(offBody).includes(FAKE_KEY));
  expectEq("missing key does not call the model", unconfigured.calls.length, 0);

  const capped = harness({
    ...emptyAiUsage(),
    months: { "2026-10": { ...emptyMonth(), costMicroUsd: 10_000_000 } },
  });
  const blocked = await capped.run("how much is left for dining?");
  expectEq("cap status", blocked.status, 402);
  const blockedBody = await blocked.json();
  expectEq("cap code", blockedBody.code, "cap");
  expect("cap message is friendly", /used up/i.test(blockedBody.message));
  expect("cap message names the cap", String(blockedBody.message).includes("$10.00"));
  expectEq("cap does not call the model", capped.calls.length, 0);
  expectEq("cap still keeps the exchange", capped.saved.length, 1);

  const open = harness({
    ...emptyAiUsage(),
    months: { "2026-10": { ...emptyMonth(), costMicroUsd: 10_000_000 - 1 } },
  });
  const streamed = await open.run("how much is left for dining?");
  expectEq("under cap streams", streamed.status, 200);
  expect(
    "stream content type",
    streamed.headers.get("content-type")?.includes("text/event-stream")
  );
  const body = await streamed.text();
  expect("stream includes deltas", body.includes("Dining has ") && body.includes("$12 left."));
  expect("stream does not leak the key", !body.includes(FAKE_KEY));
  expectEq("model was called once", open.calls.length, 1);
  const call = open.calls[0]!;
  expectEq("model id", call.model, "claude-sonnet-5-5");
  expectEq("max tokens", call.maxTokens, MAX_OUTPUT_TOKENS);
  expectEq("system cache", call.system[0]?.cache_control.type, "ephemeral");
  expectEq("system text is the prompt", call.system[0]?.text, ASSISTANT_SYSTEM_PROMPT);
  expect("snapshot is not in the system prompt", !call.system[0]?.text.includes("SnapshotOnlyCafe"));
  const lastContent = call.messages.at(-1)?.content;
  expect(
    "snapshot is in the user message",
    typeof lastContent === "string" && lastContent.includes("SnapshotOnlyCafe")
  );
  expect(
    "checking is in the user message",
    typeof lastContent === "string" && lastContent.includes("4,952.01")
  );
  expect(
    "history was trimmed",
    call.messages.every((turn, index) => {
      if (typeof turn.content !== "string" || !turn.content.includes("user-0")) return true;
      return index === call.messages.length - 1 && turn.content.includes("Earlier conversation");
    })
  );
  expectEq("last tool is cached", call.tools.at(-1)?.cache_control?.type, "ephemeral");
  expect(
    "earlier tools are outside the cache breakpoint",
    call.tools.slice(0, -1).every((tool) => tool.cache_control == null)
  );
  expect(
    "live checking balance is not in the tool definitions",
    !JSON.stringify(call.tools).includes("4,952.01")
  );
  expectEq("reply was saved", open.saved[0]?.reply, "Dining has $12 left.");
  const month = open.ledger().months["2026-10"];
  expectEq("usage added to the open cap", month?.costMicroUsd, 10_000_000 - 1 + 3_051);
  expectEq("request counted", month?.requests, 1);
  expectEq("input tokens recorded", month?.inputTokens, 1_000);
  expectEq("output tokens recorded", month?.outputTokens, 100);
  expectEq("cache write recorded", month?.cacheCreation5mTokens, 20);
  expectEq("cache read recorded", month?.cacheReadTokens, 10);

  const limited = harness();
  for (let i = 0; i < 10; i++) {
    const res = await limited.run(`question ${i}`);
    expectEq(`request ${i + 1} allowed`, res.status, 200);
    await res.text();
  }
  const eleventh = await limited.run("question 11");
  expectEq("11th request is rate limited", eleventh.status, 429);
  expectEq("rate limit does not call the model", limited.calls.length, 10);
  const later = await limited.run("question later", { now: new Date(NOW.getTime() + 61_000) });
  expectEq("rate limit window resets", later.status, 200);
  await later.text();

  const root = process.cwd();
  const route = readFileSync(path.join(root, "app/api/assistant/route.ts"), "utf8");
  const anthropic = readFileSync(path.join(root, "lib/assistant/anthropic.ts"), "utf8");
  const auth = readFileSync(path.join(root, "lib/auth.ts"), "utf8");
  expect("route checks the session cookie", route.includes("sessionCookieName()") && route.includes("sessionValid"));
  expect("route streams with the official SDK helper", route.includes("streamAssistant"));
  expect("sdk client is constructed from the passed key", anthropic.includes("new Anthropic({ apiKey: args.apiKey })"));
  expect("key is read from the env var", readFileSync(path.join(root, "lib/assistant/handle.ts"), "utf8").includes("ANTHROPIC_API_KEY"));
  expect("no hardcoded api key", !route.includes("sk-ant-") && !anthropic.includes("sk-ant-"));
  expect(
    "pin hash untouched",
    auth.includes("ed9ee901387f416dccd02ad5eea372a7e6700ee5f1c50e0fc3cacf45fc4f6e67")
  );
  expect("built-in pin still not plain text", !auth.includes("3369"));

  const added = addRequestUsage(emptyAiUsage(), "2026-10", sampleUsage({ outputTokens: 2 }), 20);
  const reserved = reserveRequest(added, NOW.getTime());
  expectEq("reserve keeps the month row", reserved.ledger.months["2026-10"]?.costMicroUsd, 20);
  expectEq("reserve records the stamp", reserved.ledger.recentRequestAt.length, 1);

  console.log("assistant ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
