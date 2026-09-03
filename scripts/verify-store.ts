import { parseResetMode, resetData } from "../lib/actions";
import { realState } from "../lib/seed";
import {
  DURABLE_WRITE_REFUSAL,
  assertDurableWrite,
  loadState,
  saveState,
  storeInfo,
} from "../lib/store";

function expect(label: string, cond: unknown, detail = "") {
  if (!cond) throw new Error(detail ? `${label}: ${detail}` : label);
}

const ENV_KEYS = [
  "VERCEL",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
] as const;

function snapshotEnv(): Record<string, string | undefined> {
  const prev: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) prev[key] = process.env[key];
  return prev;
}

function applyEnv(vars: Record<string, string | undefined>) {
  for (const key of ENV_KEYS) {
    const next = vars[key];
    if (next === undefined) delete process.env[key];
    else process.env[key] = next;
  }
}

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const prev = snapshotEnv();
  applyEnv({ ...Object.fromEntries(ENV_KEYS.map((k) => [k, undefined])), ...vars });
  try {
    return fn();
  } finally {
    applyEnv(prev);
  }
}

async function withEnvAsync<T>(
  vars: Record<string, string | undefined>,
  fn: () => Promise<T>
): Promise<T> {
  const prev = snapshotEnv();
  applyEnv({ ...Object.fromEntries(ENV_KEYS.map((k) => [k, undefined])), ...vars });
  try {
    return await fn();
  } finally {
    applyEnv(prev);
  }
}

function expectRefusal(fn: () => void) {
  try {
    fn();
  } catch (error) {
    expect(
      "refusal mentions /tmp",
      error instanceof Error && error.message === DURABLE_WRITE_REFUSAL,
      error instanceof Error ? error.message : String(error)
    );
    return;
  }
  throw new Error("expected durable write refusal");
}

async function main() {
  expect("parseResetMode real", parseResetMode("real") === "real");
  expect("parseResetMode sample", parseResetMode("sample") === "sample");
  expect("parseResetMode empty", parseResetMode("empty") === "empty");
  expect("parseResetMode keep-settings", parseResetMode("keep-settings") === "keep-settings");
  expect("parseResetMode unknown defaults to real", parseResetMode("nope") === "real");

  withEnv({}, () => {
    const info = storeInfo();
    expect("local file is durable", info.backend === "file" && info.durable);
    assertDurableWrite();
  });

  withEnv({ VERCEL: "1" }, () => {
    const info = storeInfo();
    expect("Vercel without store is not durable", info.backend === "file" && !info.durable);
    expectRefusal(() => assertDurableWrite());
  });

  withEnv({ VERCEL: "1", TURSO_DATABASE_URL: "libsql://example.turso.io" }, () => {
    const info = storeInfo();
    expect("TURSO_* selects turso", info.backend === "turso" && info.durable);
    assertDurableWrite();
  });

  withEnv(
    { VERCEL: "1", KV_REST_API_URL: "https://example.upstash.io", KV_REST_API_TOKEN: "kv-token" },
    () => {
      const info = storeInfo();
      expect("KV_REST_API_* selects kv", info.backend === "kv" && info.durable);
      assertDurableWrite();
    }
  );

  withEnv(
    {
      VERCEL: "1",
      UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
      UPSTASH_REDIS_REST_TOKEN: "upstash-token",
    },
    () => {
      const info = storeInfo();
      expect("UPSTASH_REDIS_REST_* selects kv", info.backend === "kv" && info.durable);
      assertDurableWrite();
    }
  );

  await withEnvAsync({ VERCEL: "1" }, async () => {
    let threw = false;
    try {
      await saveState(realState());
    } catch (error) {
      threw = error instanceof Error && error.message === DURABLE_WRITE_REFUSAL;
    }
    expect("saveState refuses /tmp on Vercel", threw);
  });

  await withEnvAsync({}, async () => {
    const saved = await resetData("real");
    expect("reset checking is Aug 29 snapshot", saved.state.checkingCents === 495_201);
    expect("reset paycheck net", saved.state.paycheck.netCents === 277_155);
    expect("reset paycheck anchor", saved.state.paycheck.anchorDate === "2026-08-29");
    expect("reset four bills", saved.state.bills.length === 4);
    expect("reset has no purchases", saved.state.expenses.length === 0);
    const loaded = await loadState();
    expect("reload checking after reset", loaded.checkingCents === 495_201);
    expect("reload bills after reset", loaded.bills.length === 4);
    expect("reload expenses after reset", loaded.expenses.length === 0);
  });

  console.log(
    "store durability checks passed: Turso | KV_* | UPSTASH_* | Vercel /tmp refusal | reset real snapshot"
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
