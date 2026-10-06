import { readFileSync } from "node:fs";
import path from "node:path";
import {
  consumeGreeting,
  firstName,
  greetingForHour,
  GREETING_MS,
  GREETING_REDUCED_MS,
  GREETING_STORAGE_KEY,
  requestGreetingAfterUnlock,
} from "../lib/greeting";

function expect(label: string, cond: unknown, detail = "") {
  if (!cond) throw new Error(detail ? `${label}: ${detail}` : label);
}

function expectEq(label: string, got: unknown, want: unknown) {
  if (got !== want) throw new Error(`${label}: got ${String(got)}, want ${String(want)}`);
}

function memory() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
  };
}

expectEq("before noon", greetingForHour(0), "Good morning");
expectEq("11 is morning", greetingForHour(11), "Good morning");
expectEq("noon is afternoon", greetingForHour(12), "Good afternoon");
expectEq("16 is afternoon", greetingForHour(16), "Good afternoon");
expectEq("17 is evening", greetingForHour(17), "Good evening");
expectEq("23 is evening", greetingForHour(23), "Good evening");
expectEq("first name", firstName("Arjun Kale"), "Arjun");
expectEq("already first", firstName("Arjun"), "Arjun");
expectEq("blank name falls back", firstName("   "), "Arjun");
expect("greeting stays within 1.5s", GREETING_MS <= 1500 && GREETING_REDUCED_MS <= 1500);

const fresh = memory();
expect("first home visit plays", consumeGreeting(fresh));
expectEq("marked played", fresh.getItem(GREETING_STORAGE_KEY), "played");
expect("return to home skips", !consumeGreeting(fresh));

const again = memory();
consumeGreeting(again);
requestGreetingAfterUnlock(again);
expectEq("unlock re-arms greeting", again.getItem(GREETING_STORAGE_KEY), "pending");
expect("unlock plays once", consumeGreeting(again));
expect("second home visit after unlock skips", !consumeGreeting(again));

const root = process.cwd();
const login = readFileSync(path.join(root, "components/login-screen.tsx"), "utf8");
const home = readFileSync(path.join(root, "components/home-screen.tsx"), "utf8");
const overlay = readFileSync(path.join(root, "components/greeting-overlay.tsx"), "utf8");
const css = readFileSync(path.join(root, "app/globals.css"), "utf8");

expect("login requests greeting after unlock", login.includes("requestGreetingAfterUnlock()"));
expect("home still leads with spent this month", home.includes("Spent this month"));
expect("home mounts greeting overlay", home.includes("<GreetingOverlay"));
expect("overlay does not block taps", overlay.includes("pointer-events-none"));
expect("overlay can be skipped", overlay.includes('addEventListener("pointerdown"'));
expect("reduced motion is handled", css.includes("prefers-reduced-motion: reduce"));
expect("greeting is css only", css.includes("dolla-greet-overlay") && css.includes("dolla-greet-copy"));

console.log("greeting checks passed");
