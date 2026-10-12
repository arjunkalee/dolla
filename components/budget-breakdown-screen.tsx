"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, EyeOff } from "lucide-react";
import { formatCents } from "@/lib/money";
import {
  budgetBreakdown,
  budgetCenterText,
  budgetSliceCaption,
  budgetTakeHomeNote,
  pieShowsOutsideLabel,
  type BudgetShare,
} from "@/lib/budget-share";
import { useHideDollars } from "@/lib/hide-dollars";
import { cn } from "@/lib/utils";
import { useDolla } from "./dolla-provider";

const CX = 50;
const CY = 50;
const OUTER = 46;
const INNER = 29;

export function BudgetBreakdownScreen() {
  const { state, insights } = useDolla();
  const [hideDollars, setHideDollars] = useHideDollars();
  const [activeId, setActiveId] = useState<string | null>(null);

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
  const active =
    breakdown.shares.find((share) => share.id === activeId) ??
    breakdown.shares.reduce((best, share) => (share.cents > best.cents ? share : best));
  const toggleLabel = hideDollars ? "Show dollar amounts" : "Hide dollar amounts";

  return (
    <div className="space-y-5" data-dollars={hideDollars ? "hidden" : "shown"}>
      <header className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{insights.monthLabel}</p>
          <h1 className="text-[1.75rem] font-semibold tracking-tight">Budget</h1>
        </div>
        <button
          type="button"
          aria-pressed={hideDollars}
          aria-label={toggleLabel}
          title={toggleLabel}
          onClick={() => setHideDollars(!hideDollars)}
          className={cn(
            "mb-0.5 inline-flex size-11 shrink-0 items-center justify-center rounded-full touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            hideDollars
              ? "bg-primary text-primary-foreground"
              : "bg-card text-foreground ring-1 ring-foreground/10"
          )}
        >
          {hideDollars ? (
            <EyeOff className="size-5" aria-hidden="true" />
          ) : (
            <Eye className="size-5" aria-hidden="true" />
          )}
        </button>
      </header>

      <article className="rounded-3xl bg-card px-5 py-5 ring-1 ring-foreground/10">
        <p className="text-sm text-muted-foreground">Monthly take-home</p>
        {hideDollars ? (
          <p className="mt-1 text-sm text-muted-foreground">Dollar amounts hidden</p>
        ) : (
          <p className="mt-1 font-mono text-3xl font-semibold tracking-tight">
            {formatCents(breakdown.takeHomeCents)}
          </p>
        )}
        <p className="mt-2 text-sm text-muted-foreground">
          {budgetTakeHomeNote(overTakeHome, hideDollars)}
        </p>
        <BudgetPie
          shares={breakdown.shares}
          totalCents={breakdown.totalCents}
          hideDollars={hideDollars}
          activeId={active.id}
          onSelect={setActiveId}
        />
      </article>

      <ul
        aria-label="Monthly budget by envelope"
        className="divide-y divide-border/80 overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10"
      >
        {breakdown.shares.map((share) => {
          const selected = share.id === active.id;
          return (
            <li key={share.id} className={cn(selected && "bg-muted")}>
              <button
                type="button"
                aria-current={selected ? "true" : undefined}
                onClick={() => setActiveId(share.id)}
                className="flex min-h-14 w-full items-center gap-3 px-4 text-left touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span
                  aria-hidden
                  className="size-3 shrink-0 rounded-full"
                  style={{ backgroundColor: share.color }}
                />
                <span className="min-w-0 flex-1 truncate text-base font-medium">{share.name}</span>
                {hideDollars ? null : (
                  <span className="shrink-0 font-mono text-sm tabular-nums">
                    {formatCents(share.cents)}
                  </span>
                )}
                <span
                  className={cn(
                    "shrink-0 text-right font-mono tabular-nums",
                    hideDollars ? "text-base" : "w-12 text-sm"
                  )}
                >
                  {share.percent}%
                </span>
              </button>
            </li>
          );
        })}
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

function BudgetPie({
  shares,
  totalCents,
  hideDollars,
  activeId,
  onSelect,
}: {
  shares: BudgetShare[];
  totalCents: number;
  hideDollars: boolean;
  activeId: string;
  onSelect: (id: string) => void;
}) {
  const center = budgetCenterText(totalCents, hideDollars);
  const active = shares.find((share) => share.id === activeId) ?? null;
  const tooltip = active ? budgetSliceCaption(active, hideDollars) : "Nothing to chart";

  if (totalCents <= 0) {
    return (
      <div className="relative mx-auto mt-4 aspect-square w-full">
        <svg
          viewBox="0 0 100 100"
          className="absolute top-[24%] left-[24%] h-[52%] w-[52%]"
          role="img"
          aria-label="No monthly budget to chart"
        >
          <circle cx={CX} cy={CY} r={OUTER} className="fill-muted" />
        </svg>
        <PieCenter text={center} hideDollars={hideDollars} />
      </div>
    );
  }

  const slices = layoutSlices(shares, totalCents);

  return (
    <div className="mt-4">
      <div className="relative mx-auto aspect-square w-full">
        <svg
          viewBox="0 0 100 100"
          className="absolute top-[24%] left-[24%] h-[52%] w-[52%] touch-manipulation"
          role="group"
          aria-label={`Budget chart, ${center}`}
        >
          {slices.map(({ share, start, end, sweep }) => {
            const selected = share.id === activeId;
            const caption = budgetSliceCaption(share, hideDollars);
            const full = sweep >= Math.PI * 2 - 1e-4;
            return (
              <g
                key={share.id}
                role="button"
                tabIndex={0}
                aria-label={caption}
                aria-current={selected ? "true" : undefined}
                className="cursor-pointer outline-none"
                onClick={() => onSelect(share.id)}
                onPointerEnter={(event) => {
                  if (event.pointerType === "mouse") onSelect(share.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onSelect(share.id);
                  }
                }}
              >
                <title>{caption}</title>
                {full ? (
                  <circle
                    cx={CX}
                    cy={CY}
                    r={OUTER}
                    fill={share.color}
                    opacity={selected ? 1 : 0.72}
                  />
                ) : (
                  <path
                    d={donutSlice(CX, CY, OUTER, INNER, start, end)}
                    fill={share.color}
                    stroke="var(--card)"
                    strokeWidth="0.8"
                    opacity={selected ? 1 : 0.72}
                  />
                )}
              </g>
            );
          })}
          {slices.some(({ sweep }) => sweep >= Math.PI * 2 - 1e-4) ? (
            <circle cx={CX} cy={CY} r={INNER} className="fill-card" />
          ) : null}
        </svg>
        <PieCenter text={center} hideDollars={hideDollars} />
        {slices.map(({ share, mid }) =>
          pieShowsOutsideLabel(share.percent) ? (
            <SliceLabel key={`${share.id}-label`} share={share} angle={mid} hideDollars={hideDollars} />
          ) : null
        )}
      </div>
      <p role="status" aria-live="polite" className="mt-1 min-h-6 text-center text-sm">
        {tooltip}
      </p>
    </div>
  );
}

function PieCenter({ text, hideDollars }: { text: string; hideDollars: boolean }) {
  return (
    <div className="pointer-events-none absolute top-[24%] left-[24%] flex h-[52%] w-[52%] items-center justify-center px-2">
      <p
        aria-hidden="true"
        className={cn(
          "text-center font-mono font-semibold tracking-tight",
          hideDollars ? "text-2xl leading-none" : "text-sm leading-tight"
        )}
      >
        {text}
      </p>
    </div>
  );
}

function SliceLabel({
  share,
  angle,
  hideDollars,
}: {
  share: BudgetShare;
  angle: number;
  hideDollars: boolean;
}) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const left = 50 + 31 * cos;
  const top = 50 + 31 * sin;
  const transform =
    cos > 0.25 ? "translate(0, -50%)" : cos < -0.25 ? "translate(-100%, -50%)" : sin < 0 ? "translate(-50%, -100%)" : "translate(-50%, 0)";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute font-mono leading-tight whitespace-nowrap",
        cos < -0.25 ? "text-right" : "text-left"
      )}
      style={{ left: `${left}%`, top: `${top}%`, transform }}
    >
      <span className="block text-[13px] font-semibold">{share.percent}%</span>
      {hideDollars ? null : (
        <span className="block text-[11px] text-muted-foreground">{formatCents(share.cents)}</span>
      )}
    </span>
  );
}

function layoutSlices(shares: BudgetShare[], totalCents: number) {
  const slices: {
    share: BudgetShare;
    start: number;
    end: number;
    sweep: number;
    mid: number;
  }[] = [];
  let angle = -Math.PI / 2;
  for (const share of shares) {
    if (share.cents <= 0 || totalCents <= 0) continue;
    const sweep = (share.cents / totalCents) * Math.PI * 2;
    const start = angle;
    angle += sweep;
    slices.push({ share, start, end: angle, sweep, mid: start + sweep / 2 });
  }
  return slices;
}

function donutSlice(
  cx: number,
  cy: number,
  outer: number,
  inner: number,
  start: number,
  end: number
): string {
  const sweep = end - start;
  const large = sweep > Math.PI ? 1 : 0;
  const outerStart = point(cx, cy, outer, start);
  const outerEnd = point(cx, cy, outer, end);
  const innerEnd = point(cx, cy, inner, end);
  const innerStart = point(cx, cy, inner, start);
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${outer} ${outer} 0 ${large} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${inner} ${inner} 0 ${large} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

function point(cx: number, cy: number, radius: number, angle: number) {
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}
