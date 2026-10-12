import { readFileSync } from "node:fs";
import path from "node:path";
import {
  BUDGET_SLICE_COLORS,
  budgetBreakdown,
  budgetCenterText,
  budgetSliceCaption,
  budgetTakeHomeNote,
  largestRemainderPercents,
  pieShowsOutsideLabel,
} from "../lib/budget-share";
import { formatCents } from "../lib/money";
import { parseHideDollars, serializeHideDollars } from "../lib/hide-dollars";
import { computeInsights } from "../lib/plan";
import { DEFAULT_CATEGORIES, realState } from "../lib/seed";

function expect(label: string, cond: unknown, detail = "") {
  if (!cond) throw new Error(detail ? `${label}: ${detail}` : label);
}

function expectEq(label: string, got: unknown, want: unknown) {
  if (got !== want) throw new Error(`${label}: got ${String(got)}, want ${String(want)}`);
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Independent check that percents are a largest-remainder apportionment. */
function assertLargestRemainder(label: string, amounts: number[], percents: number[]) {
  const safe = amounts.map((amount) =>
    Number.isFinite(amount) && amount > 0 ? Math.round(amount) : 0
  );
  const total = sum(safe);
  if (total <= 0) {
    expect(
      `${label} zero total`,
      percents.every((percent) => percent === 0)
    );
    return;
  }
  expectEq(`${label} sums to 100`, sum(percents), 100);
  const rows = safe.map((amount, index) => ({
    index,
    amount,
    floor: Math.floor((amount * 100) / total),
    remainder: (amount * 100) % total,
    percent: percents[index] ?? -1,
  }));
  for (const row of rows) {
    expect(
      `${label} ${row.index} is floor or floor+1`,
      row.percent === row.floor || row.percent === row.floor + 1,
      `got ${row.percent}, floor ${row.floor}`
    );
  }
  const extras = rows.filter((row) => row.percent === row.floor + 1);
  const plain = rows.filter((row) => row.percent === row.floor);
  for (const extra of extras) {
    for (const other of plain) {
      const extraWins =
        extra.remainder > other.remainder ||
        (extra.remainder === other.remainder && extra.amount > other.amount) ||
        (extra.remainder === other.remainder &&
          extra.amount === other.amount &&
          extra.index < other.index);
      expect(
        `${label} remainder order`,
        extraWins,
        `index ${extra.index} took a point over ${other.index}`
      );
    }
  }
}

const store = { backend: "file" as const, durable: true, label: "test" };
const insights = computeInsights(realState(new Date("2026-09-15T12:00:00-05:00")), "2026-09-15", store);
const envelopeSum = DEFAULT_CATEGORIES.reduce((total, category) => total + category.monthlyBudgetCents, 0);

expectEq("budget sheet matches seed envelopes", insights.monthBudgetCents, envelopeSum);
expectEq(
  "month leftover is take-home minus envelopes",
  insights.savingsSuggestion.leftoverMonthCents,
  insights.monthIncomeCents - envelopeSum
);
expect("september has take-home above the envelopes", insights.monthIncomeCents > envelopeSum);

const breakdown = budgetBreakdown({
  envelopes: insights.categories.map((category) => ({
    id: category.id,
    name: category.name,
    cents: category.budgetCents,
  })),
  monthIncomeCents: insights.monthIncomeCents,
  leftoverMonthCents: insights.savingsSuggestion.leftoverMonthCents,
});

expectEq("every envelope is listed", breakdown.shares.length, insights.categories.length + 1);
for (const category of insights.categories) {
  const share = breakdown.shares.find((row) => row.id === category.id);
  expectEq(`${category.id} amount`, share?.cents, category.budgetCents);
  expectEq(`${category.id} color`, share?.color, BUDGET_SLICE_COLORS[category.id]);
}
const invest = breakdown.shares.find((row) => row.id === "invest");
expectEq("invest name", invest?.name, "Invest");
expectEq("invest uses month leftover", breakdown.investCents, insights.savingsSuggestion.leftoverMonthCents);
expectEq("invest row amount", invest?.cents, breakdown.investCents);
expectEq("invest color", invest?.color, BUDGET_SLICE_COLORS.invest);
expectEq(
  "slices sum to take-home",
  breakdown.totalCents,
  insights.monthIncomeCents
);

const amounts = breakdown.shares.map((share) => share.cents);
const percents = breakdown.shares.map((share) => share.percent);
assertLargestRemainder("september budget", amounts, percents);
expectEq(
  "displayed percents match the helper",
  percents.join(","),
  largestRemainderPercents(amounts).join(",")
);

const naive = amounts.map((amount) => Math.round((amount * 100) / sum(amounts)));
expect(
  "naive rounding does not already sum to 100 for this budget",
  sum(naive) !== 100,
  String(sum(naive))
);

const thirds = largestRemainderPercents([1, 1, 1]);
assertLargestRemainder("thirds", [1, 1, 1], thirds);
expectEq("thirds first remainder", thirds[0], 34);
expectEq("thirds sum", sum(thirds), 100);

const derived = budgetBreakdown({
  envelopes: [{ id: "rent", name: "Rent", cents: 100 }],
  monthIncomeCents: 250,
});
expectEq("derived invest", derived.investCents, 150);
assertLargestRemainder(
  "derived",
  derived.shares.map((share) => share.cents),
  derived.shares.map((share) => share.percent)
);

const short = budgetBreakdown({
  envelopes: [{ id: "rent", name: "Rent", cents: 500 }],
  monthIncomeCents: 100,
  leftoverMonthCents: 100 - 500,
});
expectEq("negative leftover invest is zero", short.investCents, 0);
expectEq("negative leftover invest row", short.shares.find((share) => share.id === "invest")?.cents, 0);
expectEq("negative leftover invest percent", short.shares.find((share) => share.id === "invest")?.percent, 0);
assertLargestRemainder(
  "over budget",
  short.shares.map((share) => share.cents),
  short.shares.map((share) => share.percent)
);

expectEq("hidden means stored 1", parseHideDollars("1"), true);
expectEq("visible means anything else", parseHideDollars("0"), false);
expectEq("missing storage shows dollars", parseHideDollars(null), false);
expectEq("serialize hidden", serializeHideDollars(true), "1");
expectEq("serialize visible", serializeHideDollars(false), "0");

for (const share of breakdown.shares) {
  const shown = budgetSliceCaption(share, false);
  const hidden = budgetSliceCaption(share, true);
  expect(`${share.id} shown caption keeps its percent`, shown.includes(`${share.percent}%`));
  expect(`${share.id} shown caption includes dollars`, shown.includes("$"));
  expectEq(`${share.id} hidden caption`, hidden, `${share.name} · ${share.percent}%`);
  expect(`${share.id} hidden caption has no dollars`, !hidden.includes("$"));
}
expectEq(
  "center uses the same dollars as the list",
  budgetCenterText(breakdown.totalCents, false),
  formatCents(breakdown.totalCents)
);
expectEq("center hides dollars as 100%", budgetCenterText(breakdown.totalCents, true), "100%");
expectEq("empty center hides as 0%", budgetCenterText(0, true), "0%");
expect(
  "over-budget note hides the zero dollar",
  !budgetTakeHomeNote(true, true).includes("$") && budgetTakeHomeNote(true, true).includes("0%")
);
expect("over-budget note shows $0 when dollars are visible", budgetTakeHomeNote(true, false).includes("$0"));

const rentShare = breakdown.shares.find((share) => share.id === "rent");
const gasShare = breakdown.shares.find((share) => share.id === "gas");
expect("rent is wide enough for an outside label", pieShowsOutsideLabel(rentShare?.percent ?? 0));
expect("invest is wide enough for an outside label", pieShowsOutsideLabel(invest?.percent ?? 0));
expect("gas stays off the pie so small slices do not collide", !pieShowsOutsideLabel(gasShare?.percent ?? 100));

const root = process.cwd();
const screen = readFileSync(path.join(root, "components/budget-breakdown-screen.tsx"), "utf8");
const shareLib = readFileSync(path.join(root, "lib/budget-share.ts"), "utf8");
const hideLib = readFileSync(path.join(root, "lib/hide-dollars.ts"), "utf8");
const nav = readFileSync(path.join(root, "lib/nav.ts"), "utf8");
const page = readFileSync(path.join(root, "app/(app)/budget/page.tsx"), "utf8");

expect("screen uses the breakdown helper", screen.includes("budgetBreakdown("));
expect("screen reads envelope budgets from insights", screen.includes("insights.categories"));
expect("screen reads monthly take-home", screen.includes("insights.monthIncomeCents"));
expect("screen reads the month leftover", screen.includes("insights.savingsSuggestion.leftoverMonthCents"));
expect("pie and list share slice color", screen.includes("share.color"));
expect("toggle exposes pressed state", screen.includes("aria-pressed={hideDollars}"));
expect("toggle names both actions", screen.includes("Show dollar amounts") && screen.includes("Hide dollar amounts"));
expect("toggle uses an eye icon", screen.includes("EyeOff") && screen.includes("<Eye"));
expect("pie center, tooltip, and labels follow the toggle", screen.includes("budgetCenterText") && screen.includes("budgetSliceCaption") && screen.includes("pieShowsOutsideLabel"));
expect("choice is stored in localStorage", hideLib.includes("localStorage") && hideLib.includes("dolla.budget.hideDollars"));
expect("percentage helper is still the only apportionment", shareLib.includes("export function largestRemainderPercents"));
expect("page mounts the breakdown", page.includes("BudgetBreakdownScreen"));
expect("nav has a Budget tab", nav.includes('label: "Budget"') && nav.includes('href: "/budget"'));
expect(
  "amounts stay out of the screen",
  !screen.includes("1432") && !screen.includes("2782") && !screen.includes("5542") && !screen.includes("2760")
);
expect(
  "amounts stay out of the share helper",
  !shareLib.includes("1432") && !shareLib.includes("2782") && !shareLib.includes("5542") && !shareLib.includes("2760")
);

console.log("budget breakdown checks passed");
