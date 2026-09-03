"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/money";
import { formatLongDate } from "@/lib/dates";
import { useDolla } from "./dolla-provider";

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

const TOOL_LINKS = [
  { href: "/", label: "Leftover math" },
  { href: "/budget", label: "Envelopes" },
  { href: "/activity", label: "All activity" },
  { href: "/savings", label: "eTrade / Roth / HYSA" },
  { href: "/split", label: "Split" },
  { href: "/chat", label: "Chat" },
  { href: "/month", label: "Calendar" },
] as const;

export function ProfileScreen() {
  const { state, insights, importCsv, resetData } = useDolla();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  if (!state || !insights) return null;

  const upcoming = [...state.bills]
    .filter((b) => !b.paid)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const nextBill = upcoming[0];
  const billsTotalCents = upcoming.reduce((sum, b) => sum + b.amountCents, 0);

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

  async function runReset(mode: "real" | "empty" | "keep-settings", ok: string) {
    setBusy(true);
    try {
      await resetData(mode);
      toast.success(ok);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Reset failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <header className="flex items-center gap-4">
        <div
          aria-hidden
          className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/15 text-lg font-semibold tracking-tight text-primary"
        >
          {initialsFromName(state.profile.name)}
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-[1.75rem] font-semibold tracking-tight">
            {state.profile.name}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{state.profile.timezone}</p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3">
        <article className="rounded-2xl bg-card px-4 py-4 ring-1 ring-foreground/10">
          <p className="text-sm text-muted-foreground">Checking</p>
          <p className="mt-1 font-mono text-xl font-semibold tracking-tight">
            {formatCents(state.checkingCents)}
          </p>
        </article>
        <article className="rounded-2xl bg-card px-4 py-4 ring-1 ring-foreground/10">
          <p className="text-sm text-muted-foreground">Biweekly paycheck</p>
          <p className="mt-1 font-mono text-xl font-semibold tracking-tight">
            {formatCents(insights.paycheckNetCents)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Next payday {formatLongDate(insights.nextPayday)}
          </p>
        </article>
        <article className="col-span-2 rounded-2xl bg-card px-4 py-4 ring-1 ring-foreground/10">
          <p className="text-sm text-muted-foreground">Upcoming bills</p>
          {upcoming.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">No unpaid bills.</p>
          ) : (
            <>
              <p className="mt-1 font-mono text-xl font-semibold tracking-tight">
                {formatCents(billsTotalCents)}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {upcoming.length} unpaid
                {nextBill
                  ? ` · next ${nextBill.name} ${formatLongDate(nextBill.dueDate)}`
                  : ""}
              </p>
            </>
          )}
        </article>
      </section>

      <section>
        <h2 className="mb-2 px-1 text-sm font-medium">Accounts & tools</h2>
        <div className="divide-y divide-border/80 overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
          {TOOL_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex min-h-14 items-center justify-between gap-3 px-4 text-base"
            >
              {link.label}
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </div>
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
            onClick={() =>
              runReset("keep-settings", "Purchases cleared. Checking, bills, and envelopes kept.")
            }
          >
            Clear purchases
          </Button>
          <Button
            variant="outline"
            className="h-12 w-full text-base"
            disabled={busy}
            onClick={() => runReset("real", "Reloaded the Aug 29 starting ledger.")}
          >
            Reload starting ledger
          </Button>
          <Button
            variant="ghost"
            className="h-12 w-full text-base"
            disabled={busy}
            onClick={() => runReset("empty", "Blank month. Envelopes kept, checking zeroed.")}
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
