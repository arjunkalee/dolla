import { nanoid } from "nanoid";
import { sessionValid } from "@/lib/auth";
import { markBillsPastDuePaid, nowISO } from "@/lib/freshness";
import { loadState, saveState, updateState } from "@/lib/store";
import type { AppState, ChatCitation, ChatMessage } from "@/lib/types";
import { todayISO } from "@/lib/dates";
import { streamAssistant, type AssistantStreamArgs } from "./anthropic";
import { runToolLoop, type AssistantRound } from "./loop";
import { buildModelMessages, type ModelMessage } from "./messages";
import { MAX_OUTPUT_TOKENS, resolveAssistantModel } from "./models";
import { cachedSystemPrompt } from "./prompt";
import { costMicroUsd, microUsdToNumber, priceForModel, type TokenUsage } from "./pricing";
import { buildStateSnapshot } from "./snapshot";
import {
  applyMemoryTool,
  emptyMemory,
  factFromStatement,
  foldConversationSummary,
  isMemoryTool,
  persistAssistantMemory,
  readAssistantMemory,
  rememberFact,
  withMemoryTools,
  type AssistantMemory,
} from "./memory";
import { cachedAssistantTools, executeReadTool, type AssistantTool, type ToolOutcome } from "./tools";
import {
  addRequestUsage,
  capBlockMessage,
  capReached,
  monthSpendFromLedger,
  mutateAiUsage,
  normalizeAiUsage,
  reserveRequest,
  usageMonthKey,
  monthlyCapMicroUsd,
  type AiUsageLedger,
} from "./usage";
import {
  isWebSearchRequestError,
  sanitizeCitations,
  searchFailureNote,
  WEB_SEARCH_UNAVAILABLE_MESSAGE,
} from "./web-search";

const MAX_USER_CHARS = 4_000;

export type AssistantStreamCall = AssistantStreamArgs & {
  maxTokens: number;
  system: ReturnType<typeof cachedSystemPrompt>;
  tools: AssistantTool[];
  messages: ModelMessage[];
};

type HandleInput = {
  sessionToken: string | undefined | null;
  text: string;
  now?: Date;
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
  loadLedger?: () => Promise<AppState>;
  mutateUsage?: (mutator: (ledger: AiUsageLedger) => AiUsageLedger) => Promise<AiUsageLedger>;
  appendExchange?: (userText: string, reply: string, citations?: ChatCitation[]) => Promise<void>;
  streamReply?: (args: AssistantStreamCall) => Promise<AssistantRound>;
  executeTool?: (state: AppState, name: string, input: unknown, now: Date) => ToolOutcome;
  loadMemory?: () => Promise<AssistantMemory>;
  saveMemory?: (memory: AssistantMemory) => Promise<void>;
};

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

export async function handleAssistantRequest(input: HandleInput): Promise<Response> {
  if (!(await sessionValid(input.sessionToken))) {
    return json({ error: "Locked", code: "locked" }, 401);
  }

  const env = input.env ?? process.env;
  const apiKey = env.ANTHROPIC_API_KEY?.trim() ?? "";
  if (!apiKey) {
    return json(
      {
        error: "The assistant is off until ANTHROPIC_API_KEY is set on the server.",
        code: "unconfigured",
      },
      503
    );
  }

  const text = input.text.trim();
  if (!text) return json({ error: "Type something.", code: "bad_request" }, 400);
  if (text.length > MAX_USER_CHARS) {
    return json({ error: "That message is too long.", code: "bad_request" }, 400);
  }

  const now = input.now ?? new Date();
  const month = usageMonthKey(now);
  const capMicroUsd = monthlyCapMicroUsd(env);
  const model = resolveAssistantModel(env);
  const mutate = input.mutateUsage ?? mutateAiUsage;
  const append = input.appendExchange ?? persistExchange;
  const streamReply = input.streamReply ?? defaultStream;

  const gate: { block: "ok" | "cap" | "rate"; spentMicro: number } = {
    block: "ok",
    spentMicro: 0,
  };
  let gated: AiUsageLedger;
  try {
    gated = await mutate((ledger) => {
      const normalized = normalizeAiUsage(ledger);
      const spentMicro = normalized.months[month]?.costMicroUsd ?? 0;
      if (capReached(spentMicro, capMicroUsd)) {
        gate.block = "cap";
        gate.spentMicro = spentMicro;
        return normalized;
      }
      const reserved = reserveRequest(normalized, now.getTime());
      gate.block = reserved.allowed ? "ok" : "rate";
      gate.spentMicro = spentMicro;
      return reserved.ledger;
    });
  } catch (error) {
    logSafeError(error);
    return json(
      { error: "The assistant can't record usage right now.", code: "unconfigured" },
      503
    );
  }

  const spend = monthSpendFromLedger(gated, now, env);
  if (gate.block === "cap") {
    const message = capBlockMessage(gate.spentMicro, capMicroUsd);
    await append(text, message);
    await rememberStatement(resolveMemoryIo(input), text, now, apiKey);
    return json(
      {
        error: message,
        message,
        code: "cap",
        monthSpendUsd: microUsdToNumber(gate.spentMicro),
        capUsd: spend.capUsd,
        monthKey: month,
      },
      402
    );
  }
  if (gate.block === "rate") {
    return json(
      {
        error: "Too many assistant messages. Wait a minute and try again.",
        code: "rate",
        monthSpendUsd: spend.monthSpendUsd,
        capUsd: spend.capUsd,
        monthKey: month,
      },
      429
    );
  }

  const state = await (input.loadLedger ?? loadAssistantState)();
  const snapshot = buildStateSnapshot(state, now);
  const memoryIo = resolveMemoryIo(input);
  let loadedMemory = emptyMemory();
  try {
    loadedMemory = await memoryIo.load();
  } catch (error) {
    logSafeError(error, apiKey);
  }
  const memoryBaseline = JSON.stringify(loadedMemory);
  let memory = foldConversationSummary(loadedMemory, state.chatMessages);
  const stated = factFromStatement(text, state);
  if (stated) memory = rememberFact(memory, stated, now.toISOString());
  const system = cachedSystemPrompt(memory.facts.map((fact) => fact.text));
  const messages: ModelMessage[] = buildModelMessages(state.chatMessages, snapshot, text, memory.summary);
  const tools = withMemoryTools(cachedAssistantTools());
  const readTool = input.executeTool ?? executeReadTool;
  const executeTool = (ledger: AppState, name: string, toolInput: unknown, at: Date): ToolOutcome => {
    if (isMemoryTool(name)) {
      const applied = applyMemoryTool(memory, name, toolInput, now.toISOString());
      memory = applied.memory;
      return applied.outcome;
    }
    return readTool(ledger, name, toolInput, at);
  };

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      let reply = "";
      let latest = gated;
      let citations: ChatCitation[] = [];
      const commitMemory = async () => {
        const stamp = new Date().toISOString();
        const projected: ChatMessage[] = [
          ...state.chatMessages,
          { id: `pending-user-${stamp}`, role: "user", text, createdAt: stamp },
          { id: `pending-dolla-${stamp}`, role: "dolla", text: reply, createdAt: stamp },
        ];
        memory = foldConversationSummary(memory, projected);
        if (JSON.stringify(memory) === memoryBaseline) return;
        try {
          await memoryIo.save(memory);
        } catch (error) {
          logSafeError(error, apiKey);
        }
      };
      try {
        await runToolLoop({
          messages,
          capMicroUsd,
          capReached,
          capMessage: (spent) => capBlockMessage(spent, capMicroUsd),
          readSpend: async () => {
            const next = await mutate((ledger) => normalizeAiUsage(ledger));
            latest = next;
            return next.months[month]?.costMicroUsd ?? 0;
          },
          recordUsage: async (usage) => {
            const requestCost = costMicroUsd(usage, priceForModel(model));
            const updated = await mutate((ledger) =>
              addRequestUsage(normalizeAiUsage(ledger), month, usage, requestCost)
            );
            latest = updated;
            const monthCost = updated.months[month]?.costMicroUsd ?? requestCost;
            logUsage({ model, month, usage, requestCost, monthCost, capMicroUsd });
          },
          streamRound: (roundMessages, hooks) =>
            streamReply({
              apiKey,
              model,
              maxTokens: MAX_OUTPUT_TOKENS,
              system,
              tools,
              messages: roundMessages,
              signal: input.signal,
              onText: hooks.onText,
              onToolUse: hooks.onToolUse,
            }),
          executeTool: (name, toolInput) => executeTool(state, name, toolInput, now),
          emit: (event) => {
            if (event.type === "reset") {
              reply = "";
              send({ type: "reset" });
              return;
            }
            if (event.type === "looking_up") {
              send({ type: "status", status: "looking_up" });
              return;
            }
            if (event.type === "citations") {
              citations = event.citations;
              send({ type: "citations", citations: event.citations });
              return;
            }
            reply += event.text;
            send({ type: "delta", text: event.text });
          },
        });
        const saved = reply.trim() || "I don't have a reply for that.";
        await append(text, saved, citations);
        const monthCost = latest.months[month]?.costMicroUsd ?? 0;
        send({
          type: "done",
          monthSpendUsd: microUsdToNumber(monthCost),
          capUsd: microUsdToNumber(capMicroUsd),
          monthKey: month,
        });
      } catch (error) {
        logSafeError(error, apiKey);
        if (isWebSearchRequestError(error)) {
          const note = searchFailureNote(reply);
          if (note) {
            reply += note;
            send({ type: "delta", text: note });
          }
          const saved = reply.trim() || WEB_SEARCH_UNAVAILABLE_MESSAGE;
          try {
            await append(text, saved, citations);
          } catch (persistError) {
            logSafeError(persistError, apiKey);
          }
          const monthCost = latest.months[month]?.costMicroUsd ?? 0;
          send({
            type: "done",
            monthSpendUsd: microUsdToNumber(monthCost),
            capUsd: microUsdToNumber(capMicroUsd),
            monthKey: month,
          });
        } else {
          send({
            type: "error",
            message: "The assistant could not answer. Try again in a moment.",
          });
        }
      } finally {
        await commitMemory();
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

function resolveMemoryIo(input: HandleInput): {
  load: () => Promise<AssistantMemory>;
  save: (memory: AssistantMemory) => Promise<void>;
} {
  if (input.loadMemory || input.saveMemory) {
    return {
      load: input.loadMemory ?? (async () => emptyMemory()),
      save: input.saveMemory ?? (async () => undefined),
    };
  }
  if (input.appendExchange) {
    return {
      load: async () => emptyMemory(),
      save: async () => undefined,
    };
  }
  return { load: readAssistantMemory, save: persistAssistantMemory };
}

async function rememberStatement(
  memoryIo: { load: () => Promise<AssistantMemory>; save: (memory: AssistantMemory) => Promise<void> },
  text: string,
  now: Date,
  apiKey: string
) {
  const fact = factFromStatement(text);
  if (!fact) return;
  try {
    const current = await memoryIo.load();
    const next = rememberFact(current, fact, now.toISOString());
    if (next === current) return;
    await memoryIo.save(next);
  } catch (error) {
    logSafeError(error, apiKey);
  }
}

async function loadAssistantState(): Promise<AppState> {
  const loaded = await loadState();
  const settled = markBillsPastDuePaid(loaded, todayISO(), nowISO());
  return settled.changed ? saveState(settled.state) : loaded;
}

async function persistExchange(
  userText: string,
  reply: string,
  citations?: ChatCitation[]
): Promise<void> {
  const stamp = new Date().toISOString();
  const safeCitations = sanitizeCitations(citations);
  await updateState((state) => {
    const user: ChatMessage = { id: nanoid(), role: "user", text: userText, createdAt: stamp };
    const dolla: ChatMessage = {
      id: nanoid(),
      role: "dolla",
      text: reply,
      createdAt: stamp,
      ...(safeCitations.length > 0 ? { citations: safeCitations } : {}),
    };
    return {
      ...state,
      chatMessages: [...state.chatMessages, user, dolla].slice(-40),
    };
  });
}

async function defaultStream(args: AssistantStreamCall): Promise<AssistantRound> {
  return streamAssistant(args);
}

function logUsage(entry: {
  model: string;
  month: string;
  usage: TokenUsage;
  requestCost: number;
  monthCost: number;
  capMicroUsd: number;
}) {
  console.info(
    JSON.stringify({
      event: "dolla.assistant.usage",
      model: entry.model,
      month: entry.month,
      inputTokens: entry.usage.inputTokens,
      outputTokens: entry.usage.outputTokens,
      cacheCreation5mTokens: entry.usage.cacheCreation5mTokens,
      cacheCreation1hTokens: entry.usage.cacheCreation1hTokens,
      cacheReadTokens: entry.usage.cacheReadTokens,
      webSearchRequests: entry.usage.webSearchRequests ?? 0,
      requestCostMicroUsd: entry.requestCost,
      monthCostMicroUsd: entry.monthCost,
      capMicroUsd: entry.capMicroUsd,
    })
  );
}

function logSafeError(error: unknown, secret?: string) {
  const raw = error instanceof Error ? error.message : "unknown";
  let redacted = raw.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]");
  if (secret && secret.length >= 8) redacted = redacted.split(secret).join("[redacted]");
  redacted = redacted.replace(/\bpin\b(\s*[:=]\s*|\s+)['"]?\d{4,8}\b/gi, "pin [redacted]");
  console.error("dolla.assistant.error", redacted);
}
