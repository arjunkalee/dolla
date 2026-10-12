"use client";

import Link from "next/link";
import { formatCents } from "@/lib/money";
import { budgetBreakdown, type BudgetShare } from "@/lib/budget-share";
import { useDolla } from "./dolla-provider";

export function BudgetBreakdownScreen() {
  const { state, insights } = useDolla();
  if (!state || !insights) return null;

  const breakdown = budgetBreakdown({
    envelopes: insights.categories.map((category) => ({
      id: category.id,
      name: category.name,
      cents: category.budgetCents,
    })),
    monthIncomeCents: insights.monthIncomeCents,
    leftoverMonthCents: insights.savingsSuggestion.leftoverMonthCents,
  });
  const overTakeHome = breakdown.envelopeCents > breakdown.takeHomeCents;

  return (
    <div className="space-y-5">
      <header>
        <p className="text-sm text-muted-foreground">{insights.monthLabel}</p>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Budget</h1>
      </header>

      <article className="rounded-3xl bg-card px-5 py-5 ring-1 ring-foreground/10">
        <p className="text-sm text-muted-foreground">Monthly take-home</p>
        <p className="mt-1 font-mono text-3xl font-semibold tracking-tight">
          {formatCents(breakdown.takeHomeCents)}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {overTakeHome
            ? "Envelopes are above take-home, so Invest is $0."
            : "Envelopes plus Invest, the leftover after those envelopes."}
        </p>
        <BudgetPie shares={breakdown.shares} />
      </article>

      <ul
        aria-label="Monthly budget by envelope"
        className="divide-y divide-border/80 overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10"
      >
        {breakdown.shares.map((share) => (
          <li key={share.id} className="flex min-h-14 items-center gap-3 px-4">
            <span
              aria-hidden
              className="size-3 shrink-0 rounded-full"
              style={{ backgroundColor: share.color }}
            />
            <span className="min-w-0 flex-1 truncate text-base font-medium">{share.name}</span>
            <span className="shrink-0 font-mono text-sm tabular-nums">{formatCents(share.cents)}</span>
            <span className="w-12 shrink-0 text-right font-mono text-sm tabular-nums">
              {share.percent}%
            </span>
          </li>
        ))}
      </ul>

      <Link
        href="/envelopes"
        className="inline-flex min-h-12 items-center text-base font-medium text-primary"
      >
        Edit envelopes
      </Link>
    </div>
  );
}

function BudgetPie({ shares }: { shares: BudgetShare[] }) {
  const total = shares.reduce((sum, share) => sum + share.cents, 0);
  const label = shares.map((share) => `${share.name} ${share.percent}%`).join(", ");
  const cx = 100;
  const cy = 100;
  const radius = 86;

  if (total <= 0) {
    return (
      <svg
        viewBox="0 0 200 200"
        className="mx-auto mt-4 aspect-square w-full max-w-60"
        role="img"
        aria-label="No monthly take-home to chart"
      >
        <circle cx={cx} cy={cy} r={radius} className="fill-muted" />
      </svg>
    );
  }

  let angle = -Math.PI / 2;
  const slices = shares.flatMap((share) => {
    if (share.cents <= 0) return [];
    const sweep = (share.cents / total) * Math.PI * 2;
    const start = angle;
    angle += sweep;
    return [{ share, start, end: angle, sweep }];
  });

  return (
    <svg
      viewBox="0 0 200 200"
      className="mx-auto mt-4 aspect-square w-full max-w-60"
      role="img"
      aria-label={label}
    >
      {slices.map(({ share, start, end, sweep }) => {
        if (sweep >= Math.PI * 2 - 1e-4) {
          return <circle key={share.id} cx={cx} cy={cy} r={radius} fill={share.color} />;
        }
        const startX = cx + radius * Math.cos(start);
        const startY = cy + radius * Math.sin(start);
        const endX = cx + radius * Math.cos(end);
        const endY = cy + radius * Math.sin(end);
        const large = sweep > Math.PI ? 1 : 0;
        const d = `M ${cx} ${cy} L ${startX} ${startY} A ${radius} ${radius} 0 ${large} 1 ${endX} ${endY} Z`;
        return (
          <path
            key={share.id}
            d={d}
            fill={share.color}
            stroke="var(--card)"
            strokeWidth="1.25"
          />
        );
      })}
    </svg>
  );
}
