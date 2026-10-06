import { readFileSync } from "node:fs";
import path from "node:path";
import { activeNavHref, NAV_TABS } from "../lib/nav";

function expect(label: string, cond: unknown, detail = "") {
  if (!cond) throw new Error(detail ? `${label}: ${detail}` : label);
}

function expectEq(label: string, got: unknown, want: unknown) {
  if (got !== want) throw new Error(`${label}: got ${String(got)}, want ${String(want)}`);
}

expectEq("home tab is first", NAV_TABS[0]?.href, "/");
expectEq("home label", NAV_TABS[0]?.label, "Home");
expect(
  "existing destinations stay",
  ["/month", "/split", "/chat", "/profile"].every((href) =>
    NAV_TABS.some((tab) => tab.href === href)
  )
);

expectEq("home is active on /", activeNavHref("/"), "/");
expectEq("calendar stays on its route", activeNavHref("/month"), "/month");
expectEq("split stays on its route", activeNavHref("/split"), "/split");
expectEq("chat stays on its route", activeNavHref("/chat"), "/chat");
expectEq("profile stays on its route", activeNavHref("/profile"), "/profile");

for (const pathname of ["/", "/plan", "/activity", "/savings", "/budget", "/bills"]) {
  const active = activeNavHref(pathname);
  expect(
    `${pathname} does not highlight profile`,
    active !== "/profile",
    String(active)
  );
}

for (const pathname of ["/plan", "/activity", "/savings", "/budget", "/bills"]) {
  expectEq(`${pathname} highlights nothing`, activeNavHref(pathname), null);
}

const root = process.cwd();
const shell = readFileSync(path.join(root, "components/app-shell.tsx"), "utf8");
const greeting = readFileSync(path.join(root, "lib/greeting.ts"), "utf8");
const overlay = readFileSync(path.join(root, "components/greeting-overlay.tsx"), "utf8");

expect("shell renders a Home tab", shell.includes('"/": House') || shell.includes("House"));
expect("shell links home through the nav tabs", shell.includes("NAV_TABS"));
expect("shell dropped extraActive", !shell.includes("extraActive"));
expect("shell does not treat home as profile", !shell.includes('["/", "/plan"'));
expect("log button stays the center action", shell.includes('aria-label="Log a purchase"'));
expect("log button is still raised", shell.includes("-mt-5"));
expect("returning home does not re-arm the greeting", !shell.includes("requestGreetingAfterUnlock"));
expect("returning home does not write the greeting flag", !shell.includes("dolla.greeting"));
expect("greeting still consumes the session flag once", overlay.includes("consumeGreeting"));
expect(
  "played session stays quiet",
  greeting.includes('=== "played"') && greeting.includes('setItem(GREETING_STORAGE_KEY, "played")')
);

console.log("home nav checks passed");
