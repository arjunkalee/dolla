import { readFileSync } from "node:fs";
import path from "node:path";
import { computeInsights } from "../lib/plan";
import { realState } from "../lib/seed";

function expect(label: string, cond: unknown, detail = "") {
  if (!cond) throw new Error(detail ? `${label}: ${detail}` : label);
}

function expectEq(label: string, got: unknown, want: unknown) {
  if (got !== want) throw new Error(`${label}: got ${String(got)}, want ${String(want)}`);
}

const root = process.cwd();
const home = readFileSync(path.join(root, "components/home-screen.tsx"), "utf8");
const leftover = readFileSync(path.join(root, "components/leftover-card.tsx"), "utf8");
const plan = readFileSync(path.join(root, "components/plan-screen.tsx"), "utf8");
const profile = readFileSync(path.join(root, "components/profile-screen.tsx"), "utf8");

expect("home hero is Spent this month", home.includes("Spent this month"));
expect("home hero uses monthSpentCents", home.includes("insights.monthSpentCents"));
expect("home does not mount LeftoverCard", !home.includes("LeftoverCard"));
expect("home has no leftover paycheck", !home.includes("leftoverPaycheckCents") && !home.includes("Left from this paycheck"));
expect("home has no leftover checking hero", !home.includes("leftoverCheckingCents") && !home.includes("Left in checking"));
expect("home still links Split", home.includes('href="/split"'));
expect("home still links Plan", home.includes('href="/plan"'));
expect("home still has What's next", home.includes("What&apos;s next") || home.includes("What's next"));
expect("home still has Log a purchase", home.includes("Log a purchase"));
expect("leftover card still shows paycheck leftover", leftover.includes("Left from this paycheck") && leftover.includes("leftoverPaycheckCents"));
expect("leftover card still shows leftover checking", leftover.includes("Left in checking") && leftover.includes("leftoverCheckingCents"));
expect("plan still mounts leftover card", plan.includes("<LeftoverCard"));
expect(
  "profile leftover math does not point at home",
  !profile.includes('{ href: "/", label: "Leftover math" }')
);
expect("profile leftover math still reachable", profile.includes('label: "Leftover math"'));

const store = { backend: "file" as const, durable: true, label: "test" };
const insights = computeInsights(realState(new Date("2026-08-29T12:00:00-05:00")), "2026-08-29", store);
expectEq("paycheck leftover math unchanged", insights.leftoverPaycheckCents, 19_054);
expectEq("checking leftover math unchanged", insights.leftoverCheckingCents, 237_100);

console.log("home hero checks passed");
