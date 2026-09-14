"use client";

import { useState } from "react";
import { formatCents } from "@/lib/money";
import type { Formula } from "@/lib/types";
import { cn } from "@/lib/utils";

export function FormulaBlock({
  formula,
  defaultOpen = true,
  muted = false,
  inverted = false,
  quiet = false,
}: {
  formula?: Formula;
  defaultOpen?: boolean;
  muted?: boolean;
  inverted?: boolean;
  quiet?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!formula || formula.rows.length === 0) return null;

  return (
    <div className={cn("text-sm", muted && "opacity-90", inverted && "text-primary-foreground")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex min-h-11 w-full items-center gap-3 text-left",
          quiet ? "justify-start font-medium opacity-80" : "justify-between"
        )}
      >
        <span className="font-medium">{quiet && !open ? "How this is counted" : formula.title}</span>
        {quiet ? null : <span className="font-mono">{formatCents(formula.resultCents)}</span>}
      </button>
      {open ? (
        <ol className="space-y-1 border-t border-current/15 pb-2 pt-2 font-mono text-xs">
          {formula.rows.map((row, i) => {
            const op =
              row.role === "minus" ? "−" : row.role === "plus" ? "+" : row.role === "total" ? "=" : "";
            return (
              <li
                key={`${row.label}-${i}`}
                className={cn(
                  "flex items-start justify-between gap-3",
                  row.role === "total" && "border-t border-current/15 pt-1 font-semibold"
                )}
              >
                <span className="min-w-0 break-words">
                  {op ? `${op} ` : ""}
                  {row.label}
                </span>
                <span className="shrink-0">{formatCents(row.cents)}</span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
