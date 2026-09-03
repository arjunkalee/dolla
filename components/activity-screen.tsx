"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { formatCents } from "@/lib/money";
import { formatLongDate } from "@/lib/dates";
import type { CategoryId } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useDolla } from "./dolla-provider";

export function ActivityScreen() {
  const { state, recategorize, removeExpense } = useDolla();
  const [filter, setFilter] = useState<CategoryId | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);

  const expenses = useMemo(() => {
    if (!state) return [];
    return [...state.expenses]
      .filter((e) => filter === "all" || e.categoryId === filter)
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [state, filter]);

  if (!state) return null;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Activity</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Tap a purchase to recategorize. Dolla remembers the merchant next time.
        </p>
      </header>

      <div className="flex gap-2 overflow-x-auto pb-1">
        <Chip active={filter === "all"} onClick={() => setFilter("all")}>
          All
        </Chip>
        {state.categories.map((c) => (
          <Chip key={c.id} active={filter === c.id} onClick={() => setFilter(c.id)}>
            {c.name}
          </Chip>
        ))}
      </div>

      {expenses.length === 0 ? (
        <p className="rounded-2xl bg-card px-4 py-10 text-center text-sm text-muted-foreground ring-1 ring-foreground/10">
          No purchases yet. Log one with the green button, or import a CSV in Profile.
        </p>
      ) : (
        <div className="space-y-2">
          {expenses.map((e) => {
            const open = openId === e.id;
            const cat = state.categories.find((c) => c.id === e.categoryId);
            return (
              <article key={e.id} className="rounded-2xl bg-card ring-1 ring-foreground/10">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                  onClick={() => setOpenId(open ? null : e.id)}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{e.merchant}</p>
                    <p className="text-xs text-muted-foreground">
                      {cat?.name}
                      {e.autoCategorized ? " · auto" : ""} · {formatLongDate(e.date)}
                      {e.note ? ` · ${e.note}` : ""}
                    </p>
                  </div>
                  <p className="font-mono text-sm">{formatCents(e.amountCents)}</p>
                </button>
                {open && (
                  <div className="border-t border-border/80 px-4 py-3">
                    <p className="text-xs text-muted-foreground">Move to</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {state.categories.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={async () => {
                            await recategorize(e.id, c.id);
                            toast.success(`${e.merchant} → ${c.name}`);
                            setOpenId(null);
                          }}
                          className={cn(
                            "h-9 rounded-full px-3 text-xs font-medium",
                            c.id === e.categoryId
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-muted-foreground"
                          )}
                        >
                          {c.name}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="mt-3 min-h-11 text-sm text-destructive"
                      onClick={async () => {
                        await removeExpense(e.id);
                        toast.success("Removed.");
                      }}
                    >
                      Delete purchase
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "h-9 shrink-0 rounded-full px-3 text-sm font-medium",
        active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
      )}
    >
      {children}
    </button>
  );
}
