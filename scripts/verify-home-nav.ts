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
  "calendar and chat stay in the bottom nav",
  ["/month", "/chat"].every((href) => NAV_TABS.some((tab) => tab.href === href))
);
expectEq("profile left the bottom nav", NAV_TABS.length, 4);
const hrefs: readonly string[] = NAV_TABS.map((tab) => tab.href);
expectEq("tab order around the centered log button", hrefs.join(","), "/,/month,/budget,/chat");
expect("split is no longer its own tab", !hrefs.includes("/split"));
expect("profile is no longer a bottom tab", !hrefs.includes("/profile"));
expectEq(
  "tabs left of log",
  NAV_TABS.slice(0, 3)
    .map((tab) => tab.label)
    .join("|"),
  "Home|Calendar|Budget"
);
expectEq("tab right of log", NAV_TABS.slice(3).map((tab) => tab.label).join("|"), "Chat");

expectEq("home is active on /", activeNavHref("/"), "/");
expectEq("calendar stays on its route", activeNavHref("/month"), "/month");
expectEq("split route is not a tab", activeNavHref("/split"), null);
expectEq("chat stays on its route", activeNavHref("/chat"), "/chat");
expectEq("profile route highlights no tab", activeNavHref("/profile"), null);
expectEq("budget tab label", NAV_TABS.find((tab) => tab.href === "/budget")?.label, "Budget");
expectEq("budget is active on /budget", activeNavHref("/budget"), "/budget");

for (const pathname of ["/", "/plan", "/activity", "/savings", "/budget", "/split", "/bills", "/envelopes", "/profile"]) {
  expect(
    `${pathname} does not highlight a profile tab`,
    String(activeNavHref(pathname)) !== "/profile"
  );
}

for (const pathname of ["/plan", "/activity", "/savings", "/bills", "/envelopes", "/split", "/profile"]) {
  expectEq(`${pathname} highlights nothing`, activeNavHref(pathname), null);
}

const root = process.cwd();
const shell = readFileSync(path.join(root, "components/app-shell.tsx"), "utf8");
const greeting = readFileSync(path.join(root, "lib/greeting.ts"), "utf8");
const overlay = readFileSync(path.join(root, "components/greeting-overlay.tsx"), "utf8");
const splitPage = readFileSync(path.join(root, "app/(app)/split/page.tsx"), "utf8");
const nextConfig = readFileSync(path.join(root, "next.config.ts"), "utf8");
const profilePage = readFileSync(path.join(root, "app/(app)/profile/page.tsx"), "utf8");

expect("shell renders a Home tab", shell.includes('"/": House') || shell.includes("House"));
expect("shell renders a Budget tab", shell.includes('"/budget": PieChart'));
expect("shell does not keep a separate Split tab", !shell.includes('"/split"'));
expect("shell does not keep Profile as a bottom-tab icon", !shell.includes('"/profile": CircleUser'));
expect(
  "header profile icon opens /profile",
  shell.includes('href="/profile"') &&
    shell.includes('aria-label="Profile"') &&
    shell.includes("CircleUser")
);
expect("profile route still renders", profilePage.includes("ProfileScreen"));
expect("profile route has a back affordance", shell.includes('aria-label="Back"'));
expect("header respects the top safe area", shell.includes("safe-area-inset-top"));
expect(
  "log stays between Home Calendar Budget and Chat",
  shell.includes("NAV_TABS.slice(0, 3)") && shell.includes("NAV_TABS.slice(3)")
);
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
