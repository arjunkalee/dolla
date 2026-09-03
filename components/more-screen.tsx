"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useDolla } from "./dolla-provider";

export function MoreScreen() {
  const { state, insights, importCsv, resetData } = useDolla();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  if (!state || !insights) return null;

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const meta = await importCsv(file);
      toast.success(
        `Imported ${meta.added} purchase${meta.added === 1 ? "" : "s"}${meta.duplicates ? `, ${meta.duplicates} duplicates skipped` : ""}.`
      );
      if (meta.errors[0]) toast.error(meta.errors[0]);
      router.push("/activity");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">More</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {state.profile.name} · {state.profile.timezone}
        </p>
      </header>

      <section className="divide-y divide-border/80 overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
        <Link href="/" className="flex min-h-14 items-center px-4 text-base">
          Leftover math
        </Link>
        <Link href="/split" className="flex min-h-14 items-center px-4 text-base">
          Split this paycheck
        </Link>
        <Link href="/chat" className="flex min-h-14 items-center px-4 text-base">
          Chat
        </Link>
        <Link href="/month" className="flex min-h-14 items-center px-4 text-base">
          Calendar
        </Link>
        <Link href="/budget" className="flex min-h-14 items-center px-4 text-base">
          Envelopes (logged spend)
        </Link>
        <Link href="/activity" className="flex min-h-14 items-center px-4 text-base">
          All activity
        </Link>
        <Link href="/savings" className="flex min-h-14 items-center px-4 text-base">
          eTrade / Roth / HYSA
        </Link>
      </section>

      <section className="rounded-2xl bg-card px-4 py-4 ring-1 ring-foreground/10">
        <h2 className="font-medium">Import a statement</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Apple Card and most banks can export a CSV from Wallet or online banking. Dolla auto-sorts
          merchants, then you can recategorize. This is not an Apple Pay feed.
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <Button
          className="mt-3 h-12 w-full text-base"
          variant="outline"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          Choose CSV
        </Button>
      </section>

      <section className="rounded-2xl bg-card px-4 py-4 ring-1 ring-foreground/10">
        <h2 className="font-medium">Apple Pay cannot feed this app</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          There is no consumer Apple Pay API for a website. Apple Pay does not expose your purchase
          history to third-party web apps. FinanceKit can read Wallet transactions only inside a
          native iOS app that Apple has granted an entitlement. Dolla on the web will never pretend
          to pull Apple Pay or Wallet automatically. Log with one thumb, or export a CSV from Wallet
          / your bank.
        </p>
      </section>

      <section className="rounded-2xl bg-card px-4 py-4 ring-1 ring-foreground/10">
        <h2 className="font-medium">Data</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Stored with {insights.store.label}
          {insights.store.durable
            ? "."
            : ". Production will not keep purchases until Upstash Redis is attached to dolla-now."}
        </p>
        <div className="mt-3 space-y-2">
          <Button
            variant="outline"
            className="h-12 w-full text-base"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await resetData("keep-settings");
              toast.success("Purchases cleared. Checking, bills, and envelopes kept.");
              setBusy(false);
            }}
          >
            Clear purchases
          </Button>
          <Button
            variant="outline"
            className="h-12 w-full text-base"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await resetData("real");
              toast.success("Reloaded the Aug 29 starting ledger.");
              setBusy(false);
            }}
          >
            Reload starting ledger
          </Button>
          <Button
            variant="ghost"
            className="h-12 w-full text-base"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await resetData("empty");
              toast.success("Blank month. Envelopes kept, checking zeroed.");
              setBusy(false);
            }}
          >
            Start from a blank month
          </Button>
        </div>
      </section>

      <Button variant="ghost" className="h-12 w-full text-base text-muted-foreground" onClick={logout}>
        Lock Dolla
      </Button>
    </div>
  );
}
