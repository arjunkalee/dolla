import { bootstrap, resetData, setBillPaid } from "../lib/actions";
import { todayISO } from "../lib/dates";
import { markBillsPastDuePaid } from "../lib/freshness";
import { computeInsights } from "../lib/plan";
import { realState } from "../lib/seed";
import { loadState } from "../lib/store";
import type { AppState } from "../lib/types";

const store = { backend: "file" as const, durable: true, label: "test" };

function expect(label: string, cond: unknown, detail = "") {
  if (!cond) throw new Error(detail ? `${label}: ${detail}` : label);
}

function expectEq(label: string, got: unknown, want: unknown) {
  if (got !== want) throw new Error(`${label}: got ${String(got)}, want ${String(want)}`);
}

function bill(state: AppState, id: string) {
  const found = state.bills.find((item) => item.id === id);
  if (!found) throw new Error(`missing bill ${id}`);
  return found;
}

async function main() {
  const today = "2026-09-15";
  const stamp = "2026-09-15T17:00:00.000Z";
  const seed = realState();
  const checking = seed.checkingCents;
  const expenseCount = seed.expenses.length;

  const noneDue = markBillsPastDuePaid(seed, "2026-08-29", stamp);
  expect("future of Aug 29 seed stays unpaid", noneDue.changed === false);
  expect(
    "Aug 29 does not flip Aug 30 bills",
    noneDue.state.bills.every((item) => item.paid === false)
  );

  const dueToday = markBillsPastDuePaid(seed, "2026-08-30", stamp);
  expect("due today is not past due", dueToday.changed === false);

  const settled = markBillsPastDuePaid(seed, today, stamp);
  expect("Sep 15 flips past-due seed bills", settled.changed);
  expectEq("BofA auto-paid", bill(settled.state, "bofa").paid, true);
  expectEq("Apple Card auto-paid", bill(settled.state, "apple-card").paid, true);
  expectEq("Rent auto-paid", bill(settled.state, "rent").paid, true);
  expectEq("Amex future stays unpaid", bill(settled.state, "amex").paid, false);
  expectEq("checking unchanged", settled.state.checkingCents, checking);
  expectEq("no payment expense", settled.state.expenses.length, expenseCount);
  expectEq("BofA as-of stamped", bill(settled.state, "bofa").updatedAt, stamp);
  expect("Amex as-of left empty", bill(settled.state, "amex").updatedAt === undefined);
  expect("no paidExpenseId on auto-pay", bill(settled.state, "bofa").paidExpenseId === undefined);

  const dateless: AppState = {
    ...seed,
    bills: [
      ...seed.bills,
      {
        id: "undated",
        name: "No date",
        amountCents: 1000,
        dueDate: "",
        paid: false,
        kind: "other",
        fromThisCheck: true,
      },
    ],
  };
  const skipped = markBillsPastDuePaid(dateless, today, stamp);
  expectEq("empty dueDate stays unpaid", bill(skipped.state, "undated").paid, false);

  const beforeInsights = computeInsights(seed, today, store);
  const afterInsights = computeInsights(settled.state, today, store);
  const released =
    bill(seed, "bofa").amountCents +
    bill(seed, "apple-card").amountCents +
    bill(seed, "rent").amountCents;
  expectEq(
    "leftover checking treats auto-paid as paid",
    afterInsights.leftoverCheckingCents,
    beforeInsights.leftoverCheckingCents + released
  );
  expectEq(
    "leftover paycheck treats auto-paid as paid",
    afterInsights.leftoverPaycheckCents,
    beforeInsights.leftoverPaycheckCents + released
  );
  expect(
    "fromThisCheck leftover no longer reserves BofA",
    !afterInsights.formulas.checking.rows.some((row) => /bank of america/i.test(row.label))
  );

  const already = markBillsPastDuePaid(settled.state, today, "2026-09-16T00:00:00.000Z");
  expect("idempotent when already paid", already.changed === false);
  expectEq("does not restamp paid bills", bill(already.state, "bofa").updatedAt, stamp);

  await resetData("real");
  const chicagoToday = todayISO();
  const packed = await bootstrap();
  expectEq("bootstrap checking untouched", packed.state.checkingCents, checking);
  expectEq("bootstrap adds no expenses", packed.state.expenses.length, 0);
  for (const item of packed.state.bills) {
    if (item.dueDate && item.dueDate < chicagoToday) {
      expect(`${item.name} past due is paid on bootstrap`, item.paid);
      expect(`${item.name} as-of stamped on bootstrap`, Boolean(item.updatedAt));
    } else {
      expect(`${item.name} future stays unpaid`, item.paid === false);
    }
  }
  expectEq(
    "bootstrap leftover matches settled flags",
    packed.insights.leftoverCheckingCents,
    computeInsights(packed.state, chicagoToday, store).leftoverCheckingCents
  );

  const persisted = await loadState();
  for (const item of persisted.bills) {
    if (item.dueDate && item.dueDate < chicagoToday) {
      expect(`${item.name} persisted paid`, item.paid);
    }
  }

  const again = await bootstrap();
  expectEq("second bootstrap checking still same", again.state.checkingCents, checking);
  expectEq("second bootstrap still no expenses", again.state.expenses.length, 0);

  const unpaid = await setBillPaid("bofa", false);
  expectEq("manual unpaid toggle works", bill(unpaid.state, "bofa").paid, false);
  expectEq("unpay auto-marked bill does not invent checking", unpaid.state.checkingCents, checking);
  const reloaded = await bootstrap();
  expect("next load re-auto-pays past due", bill(reloaded.state, "bofa").paid);
  expectEq("re-auto-pay still does not touch checking", reloaded.state.checkingCents, checking);
  expectEq("re-auto-pay still creates no expense", reloaded.state.expenses.length, 0);

  await resetData("real");
  console.log("past-due auto-pay checks passed: flags only, leftover, persist, no checking side effects");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
