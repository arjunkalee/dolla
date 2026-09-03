import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient, type Client } from "@libsql/client";
import { Redis } from "@upstash/redis";
import type { AppState, StoreInfo } from "./types";
import { STATE_VERSION } from "./types";
import { defaultSplitAllocations, realState } from "./seed";

const FILE_REL = path.join("data", "dolla.json");
const KV_KEY = "dolla:state";

let turso: Client | null = null;
let kv: Redis | null = null;
let writeChain: Promise<unknown> = Promise.resolve();

function enqueue<T>(work: () => Promise<T>): Promise<T> {
  const next = writeChain.then(work, work);
  writeChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

/** Vercel KV marketplace (`KV_REST_API_*`) or Upstash REST (`UPSTASH_REDIS_REST_*`). */
function kvCredentials(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) return { url, token };
  return null;
}

function onVercel(): boolean {
  return process.env.VERCEL === "1";
}

export function storeInfo(): StoreInfo {
  if (process.env.TURSO_DATABASE_URL) {
    return {
      backend: "turso",
      durable: true,
      label: "Turso (libSQL)",
    };
  }
  if (kvCredentials()) {
    return {
      backend: "kv",
      durable: true,
      label: "Upstash Redis / Vercel KV",
    };
  }
  return {
    backend: "file",
    durable: !onVercel(),
    label: onVercel()
      ? "Not durable — attach Upstash Redis to dolla-now"
      : "Local JSON file",
  };
}

function filePath(): string {
  return path.join(process.cwd(), FILE_REL);
}

function getTurso(): Client {
  if (!turso) {
    turso = createClient({
      url: process.env.TURSO_DATABASE_URL as string,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
  }
  return turso;
}

function getKv(): Redis {
  if (!kv) {
    const creds = kvCredentials();
    if (!creds) throw new Error("Redis credentials are missing.");
    kv = new Redis({ url: creds.url, token: creds.token });
  }
  return kv;
}

async function ensureTursoTable() {
  await getTurso().execute(
    "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
  );
}

export const DURABLE_WRITE_REFUSAL =
  "Dolla will not write to /tmp. Attach Upstash Redis (`KV_REST_API_*` or `UPSTASH_REDIS_REST_*`) or Turso (`TURSO_*`) to the dolla-now Vercel project, then redeploy.";

/** Throws on Vercel unless Turso or Upstash/KV is configured. Never falls back to /tmp. */
export function assertDurableWrite() {
  const info = storeInfo();
  if (onVercel() && !info.durable) {
    throw new Error(DURABLE_WRITE_REFUSAL);
  }
}

async function readRaw(): Promise<AppState | null> {
  const info = storeInfo();
  if (info.backend === "turso") {
    await ensureTursoTable();
    const result = await getTurso().execute({
      sql: "SELECT value FROM kv WHERE key = ?",
      args: [KV_KEY],
    });
    const value = result.rows[0]?.value;
    if (typeof value !== "string") return null;
    return JSON.parse(value) as AppState;
  }
  if (info.backend === "kv") {
    const value = await getKv().get<AppState>(KV_KEY);
    return value ?? null;
  }
  if (onVercel()) return null;
  try {
    const text = await readFile(filePath(), "utf8");
    return JSON.parse(text) as AppState;
  } catch {
    return null;
  }
}

/** Persist path for purchases, chat money edits, and Profile → Reload starting ledger. */
async function writeRaw(state: AppState): Promise<void> {
  assertDurableWrite();
  const payload = JSON.stringify(state, null, 2);
  const info = storeInfo();
  if (info.backend === "turso") {
    await ensureTursoTable();
    await getTurso().execute({
      sql: "INSERT INTO kv(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      args: [KV_KEY, payload],
    });
    return;
  }
  if (info.backend === "kv") {
    await getKv().set(KV_KEY, state);
    return;
  }
  const full = filePath();
  await mkdir(path.dirname(full), { recursive: true });
  const tmp = `${full}.${process.pid}.tmp`;
  await writeFile(tmp, payload, "utf8");
  await rename(tmp, full);
}

function looksLikeLedger(state: unknown): state is AppState {
  if (!state || typeof state !== "object") return false;
  const value = state as Partial<AppState>;
  return Array.isArray(value.categories) && Array.isArray(value.bills) && typeof value.checkingCents === "number";
}

function normalize(state: AppState): AppState {
  return {
    ...state,
    version: STATE_VERSION,
    expenses: state.expenses ?? [],
    chatMessages: state.chatMessages ?? [],
    chatPending: state.chatPending ?? null,
    splitAllocations: state.splitAllocations?.length
      ? state.splitAllocations
      : defaultSplitAllocations(state.categories),
  };
}

export async function loadState(): Promise<AppState> {
  return enqueue(async () => {
    const existing = await readRaw();
    if (looksLikeLedger(existing)) {
      return normalize(existing);
    }
    const real = realState();
    if (storeInfo().durable || !onVercel()) {
      await writeRaw(real);
    }
    return real;
  });
}

export async function saveState(state: AppState): Promise<AppState> {
  return enqueue(async () => {
    const next = { ...normalize(state), updatedAt: new Date().toISOString() };
    await writeRaw(next);
    return next;
  });
}

export async function updateState(
  mutator: (state: AppState) => AppState
): Promise<AppState> {
  return enqueue(async () => {
    const raw = await readRaw();
    const existing = looksLikeLedger(raw) ? normalize(raw) : realState();
    const next = { ...mutator(existing), updatedAt: new Date().toISOString() };
    await writeRaw(next);
    return next;
  });
}
