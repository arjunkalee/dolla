"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Delete, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"] as const;

export function LoginScreen() {
  const router = useRouter();
  const search = useSearchParams();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [numeric, setNumeric] = useState(true);
  const [pinLength, setPinLength] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/login")
      .then((r) => r.json())
      .then((data) => {
        setConfigured(Boolean(data.configured));
        setNumeric(Boolean(data.hint?.numeric ?? true));
        setPinLength(typeof data.hint?.length === "number" ? data.hint.length : null);
      })
      .catch(() => undefined);
  }, []);

  async function unlock(value = pin) {
    if (busy) return;
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
    setError(null);
    if (key === "del") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    const maxLen = pinLength ?? 8;
    const next = (pin + key).slice(0, maxLen);
    setPin(next);
    if (pinLength === 4 && next.length === 4) {
      void unlock(next);
    }
  }

  const slots = pinLength ?? 4;

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]">
      <header className="pt-6 text-center">
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Dolla</h1>
      </header>

      <div className="flex flex-1 flex-col justify-end">
        {!configured ? (
          <p className="mb-8 text-center text-sm text-destructive">
            Set <code className="font-mono">DOLLA_PIN</code> on the server, then reload.
          </p>
        ) : numeric ? (
          <div>
            <div className="mb-3 flex justify-center gap-3" aria-label="PIN">
              {Array.from({ length: slots }).map((_, i) => (
                <span
                  key={i}
                  className={cn(
                    "size-3.5 rounded-full transition-colors",
                    error
                      ? "bg-destructive"
                      : i < pin.length
                        ? "bg-primary"
                        : "bg-muted"
                  )}
                />
              ))}
            </div>
            <div className="mb-5 min-h-10" role="alert" aria-live="polite">
              {error ? (
                <p className="rounded-xl bg-destructive/15 px-3 py-2 text-center text-sm font-medium text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-3 justify-items-center gap-y-2">
              {KEYS.map((key, i) => (
                <button
                  key={`${key}-${i}`}
                  type="button"
                  disabled={key === "" || busy}
                  onClick={() => tap(key)}
                  aria-label={key === "del" ? "Delete" : key || undefined}
                  className="flex size-[4.5rem] items-center justify-center rounded-full text-2xl font-medium active:bg-muted disabled:opacity-0"
                >
                  {key === "del" ? <Delete className="mx-auto size-6" /> : key}
                </button>
              ))}
            </div>
            <Button
              className="mt-6 h-14 w-full text-base"
              onClick={() => unlock()}
              disabled={busy || pin.length < 1}
            >
              {busy ? <Loader2 className="size-5 animate-spin" /> : "Unlock"}
            </Button>
          </div>
        ) : (
          <form
            className="space-y-3 pb-4"
            onSubmit={(e) => {
              e.preventDefault();
              void unlock();
            }}
          >
            <Input
              type="password"
              value={pin}
              onChange={(e) => {
                setError(null);
                setPin(e.target.value);
              }}
              className="h-12 text-base"
              placeholder="PIN"
              autoComplete="current-password"
              aria-invalid={Boolean(error)}
            />
            {error ? (
              <p
                className="rounded-xl bg-destructive/15 px-3 py-2 text-sm font-medium text-destructive"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            <Button className="h-14 w-full text-base" disabled={busy || pin.length < 1}>
              {busy ? <Loader2 className="size-5 animate-spin" /> : "Unlock"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
