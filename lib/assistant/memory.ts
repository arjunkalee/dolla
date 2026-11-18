import { nanoid } from "nanoid";
import { parseChat } from "@/lib/chat";
import { readJsonKey, updateJsonKey } from "@/lib/store";
import type { AppState, ChatMessage } from "@/lib/types";
import { HISTORY_LIMIT } from "./models";

/** Side document next to dolla:ai-usage. Not the ledger. */
export const AI_MEMORY_KEY = "dolla:ai-memory";

export const MAX_FACTS = 24;
export const MAX_FACT_CHARS = 160;
export const MAX_SUMMARY_CHARS = 600;
const MAX_SUMMARIZED_IDS = 80;

export type MemoryFact = {
  id: string;
  text: string;
  createdAt: string;
};

export type AssistantMemory = {
  facts: MemoryFact[];
  /** Older turns, with dollar amounts removed so they cannot be quoted as balances. */
  summary: string;
  summarizedIds: string[];
};

export type MemoryToolOutcome =
  | { ok: true; data: unknown }
  | { ok: false; error: string };

const SECRET = /sk-ant-|api[_ -]?key|\bpin\b|password|secret/i;
const MONEY_OR_LONG_NUMBER = /\$|\b\d{3,}\b/;

export function emptyMemory(): AssistantMemory {
  return { facts: [], summary: "", summarizedIds: [] };
}

export function isSafeFact(text: string): boolean {
  const fact = normalizeFactText(text);
  if (fact.length < 8 || fact.length > MAX_FACT_CHARS) return false;
  if (SECRET.test(fact) || MONEY_OR_LONG_NUMBER.test(fact)) return false;
  if (fact.includes("?")) return false;
  return true;
}

export function normalizeFactText(text: string): string {
  return text.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().replace(/[.!]+$/, "").trim();
}

/** Pull a short preference out of something Arjun just said. Dollar amounts, PINs, and keys are refused. */
export function factFromStatement(text: string, state?: AppState): string | null {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed.includes("?")) return null;
  if (state && parseChat(trimmed, state).type !== "unknown") return null;

  const explicit = trimmed.match(
    /^(?:please\s+)?(?:remember|note|don'?t forget|do not forget)(?:\s+that)?[:,]?\s+(.+)$/i
  );
  const preference = trimmed.match(/^(i (?:always|usually|prefer|like to|get paid)\b.+)$/i);
  const raw = explicit?.[1] ?? preference?.[1];
  if (!raw) return null;
  const fact = normalizeFactText(raw);
  return isSafeFact(fact) ? fact : null;
}

export function rememberFact(memory: AssistantMemory, text: string, createdAt: string): AssistantMemory {
  const fact = normalizeFactText(text);
  if (!isSafeFact(fact)) return memory;
  const key = fact.toLowerCase();
  if (memory.facts.some((row) => row.text.toLowerCase() === key)) return memory;
  const next: MemoryFact = { id: nanoid(10), text: fact, createdAt };
  return { ...memory, facts: [...memory.facts, next].slice(-MAX_FACTS) };
}

export function forgetFact(
  memory: AssistantMemory,
  query: { id?: string; text?: string }
): AssistantMemory {
  const id = query.id?.trim();
  const needle = query.text?.trim().toLowerCase();
  if (!id && !needle) return memory;
  const facts = memory.facts.filter((fact) => {
    if (id && fact.id === id) return false;
    if (needle && fact.text.toLowerCase().includes(needle)) return false;
    return true;
  });
  if (facts.length === memory.facts.length) return memory;
  return { ...memory, facts };
}

export function redactMoney(text: string): string {
  return text
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\$\s?\d[\d,]*(?:\.\d+)?/g, "[amount]")
    .replace(/\b\d{1,3}(?:,\d{3})+(?:\.\d{2})\b/g, "[amount]")
    .replace(/\s+/g, " ")
    .trim();
}

function summaryClause(message: ChatMessage): string {
  if (SECRET.test(message.text)) return "";
  const text = redactMoney(message.text);
  if (!text) return "";
  if (message.role !== "user" && !/[a-z]/i.test(text.replace(/\[amount\]/g, ""))) return "";
  const clipped = (text.length > 90 ? `${text.slice(0, 87)}...` : text).replace(/[.]+$/, "");
  return message.role === "user" ? `He said: ${clipped}.` : `Replied: ${clipped}.`;
}

function capSummary(text: string): string {
  const clean = redactMoney(text)
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, "")
    .replace(/\b(pin|password|secret|api[_ -]?key)\b/gi, "")
    .replace(/\$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  if (clean.length <= MAX_SUMMARY_CHARS) return clean;
  const tail = clean.slice(clean.length - MAX_SUMMARY_CHARS);
  const trimmed = tail.replace(/^[^.]*\.\s*/, "").trim();
  return trimmed || tail.trim();
}

/**
 * Fold chat turns that are outside the recent window into the summary.
 * Recent messages stay verbatim in the model request; this only covers the rest.
 */
export function foldConversationSummary(
  memory: AssistantMemory,
  messages: ChatMessage[],
  recentLimit = HISTORY_LIMIT
): AssistantMemory {
  const recentIds = new Set(messages.slice(-recentLimit).map((message) => message.id));
  const known = new Set(memory.summarizedIds);
  const pending = messages.filter((message) => !recentIds.has(message.id) && !known.has(message.id));
  if (pending.length === 0) return memory;
  const additions = pending.map(summaryClause).filter(Boolean);
  const summary = capSummary([memory.summary, ...additions].filter(Boolean).join(" "));
  const summarizedIds = [...memory.summarizedIds, ...pending.map((message) => message.id)].slice(
    -MAX_SUMMARIZED_IDS
  );
  return { ...memory, summary, summarizedIds };
}

export function normalizeMemory(raw: unknown): AssistantMemory {
  if (!raw || typeof raw !== "object") return emptyMemory();
  const value = raw as Partial<AssistantMemory>;
  const facts: MemoryFact[] = [];
  const seen = new Set<string>();
  if (Array.isArray(value.facts)) {
    for (const row of value.facts) {
      if (!row || typeof row !== "object") continue;
      const fact = row as Partial<MemoryFact>;
      if (typeof fact.id !== "string" || typeof fact.text !== "string") continue;
      const text = normalizeFactText(fact.text);
      if (!isSafeFact(text)) continue;
      const key = text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      facts.push({
        id: fact.id,
        text,
        createdAt: typeof fact.createdAt === "string" ? fact.createdAt : "",
      });
      if (facts.length >= MAX_FACTS) break;
    }
  }
  const summarizedIds = Array.isArray(value.summarizedIds)
    ? value.summarizedIds.filter((id): id is string => typeof id === "string" && id.length > 0).slice(-MAX_SUMMARIZED_IDS)
    : [];
  return {
    facts,
    summary: capSummary(typeof value.summary === "string" ? value.summary : ""),
    summarizedIds,
  };
}

export function isMemoryTool(name: string): boolean {
  return name === "remember_fact" || name === "forget_fact";
}

const MEMORY_TOOLS = [
  {
    name: "remember_fact",
    description:
      "Save one short preference or fact Arjun stated, such as payday weekday. No dollar amounts, balances, PINs, or API keys. Read-only toward the ledger.",
    input_schema: {
      type: "object" as const,
      properties: {
        text: {
          type: "string",
          description: "The preference in his words, without a dollar amount.",
        },
      },
      required: ["text"],
      additionalProperties: false,
    },
  },
  {
    name: "forget_fact",
    description: "Delete a saved preference. Pass the fact's text (a substring is enough) or its id. Does not change the ledger.",
    input_schema: {
      type: "object" as const,
      properties: {
        text: { type: "string", description: "Substring of the saved fact to delete." },
        id: { type: "string", description: "Id of the saved fact, if known." },
      },
      additionalProperties: false,
    },
  },
];

/** Insert memory tools before the cache breakpoint so the last tool stays cached. */
export function withMemoryTools<T extends { name: string; cache_control?: { type: "ephemeral" } }>(
  tools: readonly T[]
): T[] {
  const memory = MEMORY_TOOLS as unknown as T[];
  if (tools.length === 0) return [...memory];
  const last = tools[tools.length - 1]!;
  return [...tools.slice(0, -1), ...memory, last];
}

export function applyMemoryTool(
  memory: AssistantMemory,
  name: string,
  input: unknown,
  createdAt: string
): { memory: AssistantMemory; outcome: MemoryToolOutcome } {
  const record = input && typeof input === "object" ? (input as Record<string, unknown>) : null;
  if (!record) {
    return { memory, outcome: { ok: false, error: "That fact needs a text field." } };
  }
  if (name === "remember_fact") {
    const text = typeof record.text === "string" ? record.text : "";
    const normalized = normalizeFactText(text);
    const next = rememberFact(memory, text, createdAt);
    if (next === memory) {
      const duplicate = memory.facts.some((fact) => fact.text.toLowerCase() === normalized.toLowerCase());
      if (duplicate && normalized) {
        return { memory, outcome: { ok: true, data: { remembered: normalized, duplicate: true } } };
      }
      return {
        memory,
        outcome: { ok: false, error: "Save a short preference with no dollar amount, PIN, or API key." },
      };
    }
    return { memory: next, outcome: { ok: true, data: { remembered: next.facts.at(-1)?.text } } };
  }
  if (name === "forget_fact") {
    const text = typeof record.text === "string" ? record.text : undefined;
    const id = typeof record.id === "string" ? record.id : undefined;
    const next = forgetFact(memory, { id, text });
    if (next === memory) {
      return { memory, outcome: { ok: false, error: "No saved fact matches that." } };
    }
    return {
      memory: next,
      outcome: { ok: true, data: { forgotten: memory.facts.length - next.facts.length } },
    };
  }
  return { memory, outcome: { ok: false, error: "That tool is not available." } };
}

export async function readAssistantMemory(): Promise<AssistantMemory> {
  return normalizeMemory(await readJsonKey<unknown>(AI_MEMORY_KEY));
}

export async function persistAssistantMemory(memory: AssistantMemory): Promise<void> {
  await updateJsonKey(AI_MEMORY_KEY, emptyMemory(), () => normalizeMemory(memory));
}

export async function deleteMemoryFact(id: string): Promise<AssistantMemory> {
  const saved = await updateJsonKey<AssistantMemory>(AI_MEMORY_KEY, emptyMemory(), (current) =>
    forgetFact(normalizeMemory(current), { id })
  );
  return normalizeMemory(saved);
}

export async function clearMemorySummary(): Promise<AssistantMemory> {
  const saved = await updateJsonKey<AssistantMemory>(AI_MEMORY_KEY, emptyMemory(), (current) => {
    const memory = normalizeMemory(current);
    if (!memory.summary) return memory;
    return { ...memory, summary: "" };
  });
  return normalizeMemory(saved);
}
