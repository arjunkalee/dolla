"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Delete, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"] as const;

export function LoginScreen() {
  const router = useRouter();
  const search = useSearchParams();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [numeric, setNumeric] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/login")
      .then((r) => r.json())
      .then((data) => {
        setConfigured(Boolean(data.configured));
        setNumeric(Boolean(data.hint?.numeric ?? true));
      })
      .catch(() => undefined);
  }, []);

  async function unlock(value = pin) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: value }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Wrong PIN.");
        setPin("");
        return;
      }
      router.replace(search.get("next") || "/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  function tap(key: (typeof KEYS)[number]) {
    if (key === "" || busy) return;
    if (key === "del") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    const next = (pin + key).slice(0, 8);
    setPin(next);
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-between px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(2rem,env(safe-area-inset-top))]">
      <div>
        <p className="text-sm text-muted-foreground">Personal ledger</p>
        <h1 className="mt-1 text-4xl font-semibold tracking-tight">Dolla</h1>
        <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
          Arjun, this is just your money. Unlock it the same way you would a notes app — not a bank.
        </p>
      </div>

      {!configured ? (
        <p className="text-sm text-destructive">
          Set <code className="font-mono">DOLLA_PIN</code> on the server, then reload.
        </p>
      ) : numeric ? (
        <div>
          <div className="mb-6 flex justify-center gap-2">
            {Array.from({ length: Math.max(4, pin.length || 4) }).map((_, i) => (
              <span
                key={i}
                className={`size-3 rounded-full ${i < pin.length ? "bg-primary" : "bg-muted"}`}
              />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {KEYS.map((key, i) => (
              <button
                key={`${key}-${i}`}
                type="button"
                disabled={key === "" || busy}
                onClick={() => tap(key)}
                className="h-16 rounded-2xl text-2xl font-medium active:bg-muted disabled:opacity-0"
              >
                {key === "del" ? <Delete className="mx-auto size-6" /> : key}
              </button>
            ))}
          </div>
          {error && <p className="mt-4 text-center text-sm text-destructive">{error}</p>}
          <Button
            className="mt-6 h-12 w-full text-base"
            onClick={() => unlock()}
            disabled={busy || pin.length < 1}
          >
            {busy ? <Loader2 className="size-5 animate-spin" /> : "Unlock"}
          </Button>
        </div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void unlock();
          }}
        >
          <Input
            type="password"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className="h-12 text-base"
            placeholder="PIN"
            autoComplete="current-password"
          />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button className="h-12 w-full text-base" disabled={busy}>
            Unlock
          </Button>
        </form>
      )}
    </div>
  );
}
