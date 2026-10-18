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
  "calendar, chat, and profile stay",
  ["/month", "/chat", "/profile"].every((href) => NAV_TABS.some((tab) => tab.href === href))
);
expectEq("one combined money tab", NAV_TABS.length, 5);
const hrefs: readonly string[] = NAV_TABS.map((tab) => tab.href);
expect("split is no longer its own tab", !hrefs.includes("/split"));

expectEq("home is active on /", activeNavHref("/"), "/");
expectEq("calendar stays on its route", activeNavHref("/month"), "/month");
expectEq("split route is not a tab", activeNavHref("/split"), null);
expectEq("chat stays on its route", activeNavHref("/chat"), "/chat");
expectEq("profile stays on its route", activeNavHref("/profile"), "/profile");
expectEq("budget tab label", NAV_TABS.find((tab) => tab.href === "/budget")?.label, "Budget");
expectEq("budget is active on /budget", activeNavHref("/budget"), "/budget");

for (const pathname of ["/", "/plan", "/activity", "/savings", "/budget", "/split", "/bills", "/envelopes"]) {
  const active = activeNavHref(pathname);
  expect(
    `${pathname} does not highlight profile`,
    active !== "/profile",
    String(active)
  );
}

for (const pathname of ["/plan", "/activity", "/savings", "/bills", "/envelopes", "/split"]) {
  expectEq(`${pathname} highlights nothing`, activeNavHref(pathname), null);
}

const root = process.cwd();
const shell = readFileSync(path.join(root, "components/app-shell.tsx"), "utf8");
const greeting = readFileSync(path.join(root, "lib/greeting.ts"), "utf8");
const overlay = readFileSync(path.join(root, "components/greeting-overlay.tsx"), "utf8");
const splitPage = readFileSync(path.join(root, "app/(app)/split/page.tsx"), "utf8");
const nextConfig = readFileSync(path.join(root, "next.config.ts"), "utf8");

expect("shell renders a Home tab", shell.includes('"/": House') || shell.includes("House"));
expect("shell renders a Budget tab", shell.includes('"/budget": PieChart'));
expect("shell does not keep a separate Split tab", !shell.includes('"/split"'));
expect(
  "split deep link redirects to the combined tab",
  splitPage.includes('redirect("/budget")') &&
    nextConfig.includes('source: "/split"') &&
    nextConfig.includes('destination: "/budget"')
);
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
