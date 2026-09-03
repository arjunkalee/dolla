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
}: {
  formula?: Formula;
  defaultOpen?: boolean;
  muted?: boolean;
  inverted?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (!formula || formula.rows.length === 0) return null;

  return (
    <div className={cn("text-sm", muted && "opacity-90", inverted && "text-primary-foreground")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
      >
        <span className="font-medium">{formula.title}</span>
        <span className="font-mono">{formatCents(formula.resultCents)}</span>
      </button>
      {open && (
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
      )}
    </div>
  );
}
