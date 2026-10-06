import { chicagoNow } from "./dates";

/** Session flag for the post-unlock home greeting (DOLLA-9). */
export const GREETING_STORAGE_KEY = "dolla.greeting";

/** Fade in, hold, fade out. Stays at or under 1.5s. */
export const GREETING_MS = 1400;

/** Static hold when the user prefers reduced motion. */
export const GREETING_REDUCED_MS = 900;

export type TimeOfDayGreeting = "Good morning" | "Good afternoon" | "Good evening";

type GreetingStore = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/** Morning before 12:00, afternoon until 17:00, evening after that. */
export function greetingForHour(hour: number): TimeOfDayGreeting {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/** Same America/Chicago clock as the home header. */
export function greetingForDate(date = new Date()): TimeOfDayGreeting {
  return greetingForHour(chicagoNow(date).getHours());
}

export function firstName(name: string): string {
  const part = name.trim().split(/\s+/)[0];
  return part || "Arjun";
}

function browserSession(): GreetingStore | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** Mark the next home visit to play the greeting. Called after a successful PIN unlock. */
export function requestGreetingAfterUnlock(storage?: GreetingStore): void {
  const target = storage ?? browserSession();
  if (!target) return;
  try {
    target.setItem(GREETING_STORAGE_KEY, "pending");
  } catch {
    // Unlock still succeeds if sessionStorage is blocked.
  }
}

/**
 * Play on the first home visit of this session, or right after unlock (`pending`).
 * A later visit in the same session sees `played` and skips.
 */
export function consumeGreeting(storage: GreetingStore): boolean {
  if (storage.getItem(GREETING_STORAGE_KEY) === "played") return false;
  storage.setItem(GREETING_STORAGE_KEY, "played");
  return true;
}
