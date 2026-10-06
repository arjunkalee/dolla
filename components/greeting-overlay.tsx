"use client";

import { useEffect, useState } from "react";
import {
  consumeGreeting,
  firstName,
  greetingForDate,
  GREETING_MS,
  GREETING_REDUCED_MS,
  type TimeOfDayGreeting,
} from "@/lib/greeting";

/**
 * Full-screen greeting over the home hero. Fixed positioning so the
 * spent-this-month layout underneath does not move when it leaves.
 * Pointer events stay off so taps reach the hero; a window listener skips it.
 */
export function GreetingOverlay({ name }: { name: string }) {
  const displayName = firstName(name);
  const [phrase, setPhrase] = useState<TimeOfDayGreeting | null>(null);

  useEffect(() => {
    let alive = true;
    const frame = requestAnimationFrame(() => {
      if (!alive) return;
      try {
        if (!consumeGreeting(window.sessionStorage)) return;
      } catch {
        return;
      }
      if (!alive) return;
      setPhrase(greetingForDate(new Date()));
    });
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (!phrase) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(
      () => setPhrase(null),
      reduce ? GREETING_REDUCED_MS : GREETING_MS + 80
    );
    const skip = () => setPhrase(null);
    window.addEventListener("pointerdown", skip);
    window.addEventListener("keydown", skip);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", skip);
      window.removeEventListener("keydown", skip);
    };
  }, [phrase]);

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {phrase ? `${phrase}, ${displayName}` : ""}
      </p>
      {phrase ? (
        <div
          className="dolla-greet-overlay pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background px-6 pb-24"
          style={{ animationDuration: `${GREETING_MS}ms` }}
          data-greeting={phrase}
          aria-hidden="true"
          onAnimationEnd={(event) => {
            if (event.target === event.currentTarget) setPhrase(null);
          }}
        >
          <p
            className="dolla-greet-copy text-center text-[2.25rem] font-semibold leading-tight tracking-tight"
            style={{ animationDuration: `${GREETING_MS}ms` }}
          >
            {phrase},
            <span className="mt-2 block text-[2.75rem]">{displayName}</span>
          </p>
        </div>
      ) : null}
    </>
  );
}
