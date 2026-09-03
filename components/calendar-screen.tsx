"use client";

import { useMemo, useState } from "react";
import { formatCents } from "@/lib/money";
import { daysInMonth, formatLongDate, formatMonthLabel, startOfMonth } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useDolla } from "./dolla-provider";

export function CalendarScreen() {
  const { state, insights } = useDolla();
  const [selected, setSelected] = useState<string | null>(null);

  const months = useMemo(() => {
    if (!insights) return [];
    const keys = new Set<string>();
    keys.add(insights.monthKey);
    keys.add(insights.nextPayday.slice(0, 7));
    for (const ev of insights.calendar) keys.add(ev.date.slice(0, 7));
    return [...keys].sort();
  }, [insights]);

  if (!state || !insights) return null;

  const day = selected ?? insights.todayISO;
  const dayEvents = insights.calendar.filter((e) => e.date === day);
  const upcoming = insights.calendar.filter((e) => e.date >= insights.todayISO).slice(0, 16);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Calendar</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paydays, bills, and logged spend. Leftover math lives on Home and Split.
        </p>
      </header>

      {months.map((key) => (
        <MonthGrid
          key={key}
          monthISO={`${key}-01`}
          events={insights.calendar.filter((e) => e.date.startsWith(key))}
          today={insights.todayISO}
          selected={day}
          onSelect={setSelected}
        />
      ))}

      <section>
        <h2 className="mb-2 text-sm font-medium">{formatLongDate(day)}</h2>
        <div className="divide-y divide-border/80 overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
          {dayEvents.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing on this day.</p>
          ) : (
            dayEvents.map((ev, i) => (
              <EventRow key={`${ev.date}-${ev.label}-${i}`} ev={ev} />
            ))
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium">Coming up</h2>
        <div className="divide-y divide-border/80 overflow-hidden rounded-2xl bg-card ring-1 ring-foreground/10">
          {upcoming.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">No upcoming dates.</p>
          ) : (
            upcoming.map((ev, i) => <EventRow key={`${ev.date}-${ev.label}-${i}`} ev={ev} />)
          )}
        </div>
      </section>
    </div>
  );
}

function EventRow({
  ev,
}: {
  ev: { date: string; kind: string; label: string; cents: number; paid?: boolean };
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate font-medium">{ev.label}</p>
        <p className="text-xs text-muted-foreground">
          {formatLongDate(ev.date)}
          {ev.kind === "payday" ? " · payday" : ev.kind === "spend" ? " · spend" : ev.paid ? " · paid" : " · due"}
        </p>
      </div>
      <p className="font-mono text-sm">{formatCents(ev.cents)}</p>
    </div>
  );
}

function MonthGrid({
  monthISO,
  events,
  today,
  selected,
  onSelect,
}: {
  monthISO: string;
  events: { date: string; kind: string }[];
  today: string;
  selected: string;
  onSelect: (iso: string) => void;
}) {
  const start = startOfMonth(monthISO);
  const dim = daysInMonth(monthISO);
  const firstWeekday = new Date(`${start}T12:00:00`).getDay();
  const cells: Array<string | null> = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: dim }, (_, i) => {
      const d = String(i + 1).padStart(2, "0");
      return `${start.slice(0, 7)}-${d}`;
    }),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="rounded-2xl bg-card px-3 py-3 ring-1 ring-foreground/10">
      <p className="mb-2 text-sm font-medium">{formatMonthLabel(monthISO)}</p>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground">
        {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
          <div key={`${d}-${i}`}>{d}</div>
        ))}
        {cells.map((iso, i) => {
          if (!iso) return <div key={`e-${i}`} />;
          const dayEvents = events.filter((e) => e.date === iso);
          const isToday = iso === today;
          const isSelected = iso === selected;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelect(iso)}
              className={cn(
                "flex min-h-10 flex-col items-center justify-center rounded-lg text-xs",
                isSelected && "bg-primary text-primary-foreground",
                !isSelected && isToday && "ring-1 ring-primary",
                !isSelected && !isToday && dayEvents.length > 0 && "bg-muted"
              )}
            >
              {Number(iso.slice(8))}
              {dayEvents.length > 0 && (
                <span className="mt-0.5 flex gap-0.5">
                  {dayEvents.slice(0, 3).map((e, idx) => (
                    <span
                      key={idx}
                      className={cn(
                        "size-1 rounded-full",
                        isSelected
                          ? "bg-primary-foreground"
                          : e.kind === "payday"
                            ? "bg-primary"
                            : e.kind === "spend"
                              ? "bg-amber-400"
                              : "bg-foreground/50"
                      )}
                    />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
