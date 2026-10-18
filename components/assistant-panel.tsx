"use client";

import { useEffect, useState } from "react";
import { Progress } from "@/components/ui/progress";

type Spend = {
  monthSpendUsd: number;
  capUsd: number;
  requests: number;
  resetOn: string;
};

type Fact = {
  id: string;
  text: string;
  createdAt: string;
};

type Memory = {
  facts: Fact[];
  summary: string;
};

function isSpend(data: unknown): data is Spend {
  if (!data || typeof data !== "object") return false;
  const row = data as Partial<Spend>;
  return (
    typeof row.monthSpendUsd === "number" &&
    typeof row.capUsd === "number" &&
    typeof row.requests === "number" &&
    typeof row.resetOn === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(row.resetOn)
  );
}

function isMemory(data: unknown): data is Memory {
  if (!data || typeof data !== "object") return false;
  const row = data as Partial<Memory>;
  if (typeof row.summary !== "string" || !Array.isArray(row.facts)) return false;
  return row.facts.every(
    (fact) =>
      fact &&
      typeof fact === "object" &&
      typeof (fact as Fact).id === "string" &&
      typeof (fact as Fact).text === "string"
  );
}

export function AssistantPanel() {
  const [spend, setSpend] = useState<Spend | null>(null);
  const [spendError, setSpendError] = useState<string | null>(null);
  const [memory, setMemory] = useState<Memory | null>(null);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    fetch("/api/assistant", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: unknown) => {
        if (cancel) return;
        if (!isSpend(data)) {
          setSpendError("This month's assistant spend isn't available.");
          return;
        }
        setSpend(data);
      })
      .catch(() => {
        if (!cancel) setSpendError("This month's assistant spend isn't available.");
      });
    fetch("/api/assistant/memory", { cache: "no-store" })
      .then(async (res) => ({ ok: res.ok, data: (await res.json().catch(() => null)) as unknown }))
      .then((result) => {
        if (cancel) return;
        if (!result.ok || !isMemory(result.data)) {
          setMemoryError("Memory isn't available right now.");
          return;
        }
        setMemory(result.data);
      })
      .catch(() => {
        if (!cancel) setMemoryError("Memory isn't available right now.");
      });
    return () => {
      cancel = true;
    };
  }, []);

  async function removeFact(id: string) {
    setBusyId(id);
    setMemoryError(null);
    try {
      const res = await fetch("/api/assistant/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "delete", id }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok || !isMemory(data)) {
        setMemoryError("Could not delete that.");
        return;
      }
      setMemory(data);
    } catch {
      setMemoryError("Could not delete that.");
    } finally {
      setBusyId(null);
    }
  }

  async function clearSummary() {
    setBusyId("summary");
    setMemoryError(null);
    try {
      const res = await fetch("/api/assistant/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ op: "clear-summary" }),
      });
      const data: unknown = await res.json().catch(() => null);
      if (!res.ok || !isMemory(data)) {
        setMemoryError("Could not clear the summary.");
        return;
      }
      setMemory(data);
    } catch {
      setMemoryError("Could not clear the summary.");
    } finally {
      setBusyId(null);
    }
  }

  const percent =
    spend && spend.capUsd > 0 ? Math.min(100, (spend.monthSpendUsd / spend.capUsd) * 100) : 0;

  return (
    <section aria-label="Assistant" className="rounded-2xl bg-card px-4 py-4 ring-1 ring-foreground/10">
      <h2 className="font-medium">Assistant</h2>
      {spend ? (
        <>
          <p className="mt-1 font-mono text-xl font-semibold tracking-tight">
            {formatAiUsd(spend.monthSpendUsd)}
            <span className="text-base font-normal text-muted-foreground"> of {formatAiUsd(spend.capUsd)}</span>
          </p>
          <Progress
            value={percent}
            max={100}
            className="mt-3"
            aria-label="Month-to-date assistant spend"
          />
          <p className="mt-2 text-sm text-muted-foreground">
            {spend.requests} {spend.requests === 1 ? "request" : "requests"} this month
          </p>
          <p className="text-sm text-muted-foreground">Last reset {formatResetDate(spend.resetOn)}</p>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">
          {spendError ?? "Loading this month's assistant spend…"}
        </p>
      )}

      <h3 className="mt-4 text-sm font-medium">Memory</h3>
      {memoryError && <p className="mt-1 text-sm text-destructive">{memoryError}</p>}
      {memory && memory.facts.length === 0 && !memory.summary && (
        <p className="mt-1 text-sm text-muted-foreground">
          Nothing saved yet. In Chat, say “I get paid on Fridays”.
        </p>
      )}
      {memory && memory.facts.length > 0 && (
        <ul className="mt-2 divide-y divide-border/80">
          {memory.facts.map((fact) => (
            <li key={fact.id} className="flex items-start justify-between gap-3 py-2">
              <span className="text-sm">{fact.text}</span>
              <button
                type="button"
                className="shrink-0 text-sm text-muted-foreground disabled:opacity-50"
                disabled={busyId === fact.id}
                onClick={() => void removeFact(fact.id)}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      {memory?.summary ? (
        <div className="mt-3">
          <p className="text-xs font-medium text-muted-foreground">Earlier chat</p>
          <p className="mt-1 text-sm text-muted-foreground">{memory.summary}</p>
          <button
            type="button"
            className="mt-2 text-sm text-muted-foreground disabled:opacity-50"
            disabled={busyId === "summary"}
            onClick={() => void clearSummary()}
          >
            Clear summary
          </button>
        </div>
      ) : null}
    </section>
  );
}

function formatAiUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
  }).format(value);
}

function formatResetDate(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, (month || 1) - 1, day || 1));
}
