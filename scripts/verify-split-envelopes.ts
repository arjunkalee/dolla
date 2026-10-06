import { readFileSync } from "node:fs";
import path from "node:path";
import { envelopeSpend } from "../lib/envelope-spend";
import { computeInsights } from "../lib/plan";
import { realState } from "../lib/seed";

function expect(label: string, cond: unknown, detail = "") {
  if (!cond) throw new Error(detail ? `${label}: ${detail}` : label);
}

function expectEq(label: string, got: unknown, want: unknown) {
  if (got !== want) throw new Error(`${label}: got ${String(got)}, want ${String(want)}`);
}

const root = process.cwd();
const split = readFileSync(path.join(root, "components/split-screen.tsx"), "utf8");
const budget = readFileSync(path.join(root, "components/budget-screen.tsx"), "utf8");
const home = readFileSync(path.join(root, "components/home-screen.tsx"), "utf8");

expect("split uses shared envelope spend", split.includes("envelopeSpend(insights.categories"));
expect("split does not recompute from expenses", !split.includes("state.expenses"));
expect("split marks empty envelopes", split.includes('data-envelope={bucket.kind === "envelope" ? (empty ? "empty" : "populated") : undefined}'));
expect("split shows spent against budget", split.includes("formatCents(spentShown)") && split.includes("formatCents(budgetCents)"));
expect("split mutes empty envelopes", split.includes("text-muted-foreground/75") && split.includes("Empty this month"));
expect("split still lists every allocation", split.includes("insights.splitAllocations.map"));
expect("budget sheet still uses category spent", budget.includes("status.spentCents"));
expect("home still uses month spent", home.includes("insights.monthSpentCents"));

const store = { backend: "file" as const, durable: true, label: "test" };
const state = realState(new Date("2026-09-15T12:00:00-05:00"));
state.expenses = [
  {
    id: "groc",
    amountCents: 4_200,
    merchant: "grocer",
    note: "",
    categoryId: "groceries",
    date: "2026-09-02",
    source: "manual",
    createdAt: "2026-09-02T17:00:00.000Z",
    autoCategorized: false,
  },
  {
    id: "dine",
    amountCents: 1_800,
    merchant: "diner",
    note: "",
    categoryId: "dining",
    date: "2026-09-10",
    source: "manual",
    createdAt: "2026-09-10T17:00:00.000Z",
    autoCategorized: false,
  },
  {
    id: "rent-paid",
    amountCents: 143_200,
    merchant: "Rent",
    note: "",
    categoryId: "rent",
    date: "2026-09-01",
    source: "bill",
    createdAt: "2026-09-01T17:00:00.000Z",
    autoCategorized: false,
  },
  {
    id: "old",
    amountCents: 9_999,
    merchant: "old",
    note: "",
    categoryId: "gas",
    date: "2026-08-20",
    source: "manual",
    createdAt: "2026-08-20T17:00:00.000Z",
    autoCategorized: false,
  },
];

const insights = computeInsights(state, "2026-09-15", store);
const groceries = envelopeSpend(insights.categories, "groceries");
const dining = envelopeSpend(insights.categories, "dining");
const gas = envelopeSpend(insights.categories, "gas");
const rent = envelopeSpend(insights.categories, "rent");

expectEq("groceries spent", groceries.spentCents, 4_200);
expectEq("groceries budget unchanged", groceries.budgetCents, 25_000);
expect("groceries populated", !groceries.empty);
expectEq("dining spent", dining.spentCents, 1_800);
expect("dining populated", !dining.empty);
expectEq("gas empty this month", gas.spentCents, 0);
expect("gas stays empty", gas.empty);
expectEq("gas budget unchanged", gas.budgetCents, 10_000);
expectEq("rent spent", rent.spentCents, 143_200);

const categorySum = insights.categories.reduce((sum, c) => sum + c.spentCents, 0);
expectEq("category ledger matches Spent this month", categorySum, insights.monthSpentCents);
expectEq("month spent", insights.monthSpentCents, 4_200 + 1_800 + 143_200);

const listed = insights.splitAllocations.reduce(
  (sum, a) => sum + envelopeSpend(insights.categories, a.categoryId).spentCents,
  0
);
expectEq("split envelopes omit rent", listed, 4_200 + 1_800);
expect(
  "every flexible envelope is still listed",
  insights.splitAllocations.length === state.categories.filter((c) => c.kind === "flexible").length
);

const quiet = realState(new Date("2026-08-29T12:00:00-05:00"));
const quietInsights = computeInsights(quiet, "2026-08-29", store);
expectEq("seed month spent still zero", quietInsights.monthSpentCents, 0);
for (const allocation of quietInsights.splitAllocations) {
  const spend = envelopeSpend(quietInsights.categories, allocation.categoryId);
  expect(`${allocation.categoryId} empty on seed`, spend.empty);
  expectEq(`${allocation.categoryId} budget`, spend.budgetCents, allocation.suggestedCents * 2);
}

console.log("split envelope checks passed");
