import { applyChatMessage, importStatement, resetData, saveBills, saveChecking } from "../lib/actions";
import { formatAsOf } from "../lib/dates";
import { stampChangedBills } from "../lib/freshness";
import { realState } from "../lib/seed";
import { loadState, saveState } from "../lib/store";
import type { AppState } from "../lib/types";
import { readFile } from "node:fs/promises";
import path from "node:path";

function expect(label: string, cond: unknown, detail = "") {
  if (!cond) throw new Error(detail ? `${label}: ${detail}` : label);
}

function expectEq(label: string, got: unknown, want: unknown) {
  if (got !== want) throw new Error(`${label}: got ${String(got)}, want ${String(want)}`);
}

async function main() {
  const asOf = formatAsOf("2026-09-14T19:14:00.000-05:00");
  expect("formatAsOf prefix", Boolean(asOf?.startsWith("as of Sep 14")));
  expect("formatAsOf time", Boolean(asOf?.includes("7:14")));
  expect("formatAsOf CT", Boolean(asOf?.endsWith("CT")));
  expect("formatAsOf missing", formatAsOf(undefined) === null);
  expect("formatAsOf invalid", formatAsOf("not-a-date") === null);

  const seed = realState();
  const stamped = stampChangedBills(
    seed.bills,
    seed.bills.map((bill) =>
      bill.id === "amex" ? { ...bill, amountCents: 141_635 } : bill
    ),
    "2026-09-14T19:14:00.000Z"
  );
  expectEq("stamps amex only", stamped.find((b) => b.id === "amex")?.updatedAt, "2026-09-14T19:14:00.000Z");
  expect("leaves bofa unstamped", stamped.find((b) => b.id === "bofa")?.updatedAt === undefined);
  expect("leaves apple unstamped", stamped.find((b) => b.id === "apple-card")?.updatedAt === undefined);
  expect("leaves rent unstamped", stamped.find((b) => b.id === "rent")?.updatedAt === undefined);
  expectEq("does not invent amex amount in seed", seed.bills.find((b) => b.id === "amex")?.amountCents, 141_652);

  await resetData("real");
  const before = await loadState();
  expect("seed has no checking as-of", before.checkingUpdatedAt === undefined);
  expect(
    "seed bills have no as-of",
    before.bills.every((bill) => bill.updatedAt === undefined)
  );
  expectEq("seed checking unchanged", before.checkingCents, 495_201);

  const resetPack = await resetData("real");
  const leftoverBefore = resetPack.insights.leftoverCheckingCents;

  const checkingSaved = await saveChecking(0);
  expectEq("saveChecking writes zero", checkingSaved.state.checkingCents, 0);
  expect("saveChecking stamps checking", Boolean(checkingSaved.state.checkingUpdatedAt));
  expectEq(
    "leftover checking follows save",
    checkingSaved.insights.leftoverCheckingCents,
    leftoverBefore - 495_201
  );

  await resetData("real");
  const live = await loadState();
  const amex = live.bills.find((b) => b.id === "amex");
  if (!amex) throw new Error("missing amex");
  const billsSaved = await saveBills(
    live.bills.map((bill) =>
      bill.id === "amex" ? { ...bill, amountCents: 141_635, dueDate: "2026-10-15" } : bill
    )
  );
  const savedAmex = billsSaved.state.bills.find((b) => b.id === "amex");
  const savedBofa = billsSaved.state.bills.find((b) => b.id === "bofa");
  expectEq("amex amount saved", savedAmex?.amountCents, 141_635);
  expectEq("amex due saved", savedAmex?.dueDate, "2026-10-15");
  expect("amex as-of stamped", Boolean(savedAmex?.updatedAt));
  expect("bofa as-of still empty", savedBofa?.updatedAt === undefined);
  expectEq("checking untouched by bill edit", billsSaved.state.checkingCents, 495_201);
  const replay = await saveBills(billsSaved.state.bills);
  expectEq("unchanged save keeps amex as-of", replay.state.bills.find((b) => b.id === "amex")?.updatedAt, savedAmex?.updatedAt);

  await resetData("real");
  const beforeBofa = await resetData("real");
  const leftoverWithBofa = beforeBofa.insights.leftoverCheckingCents;
  const bofaLive = beforeBofa.state.bills.find((b) => b.id === "bofa");
  if (!bofaLive) throw new Error("missing bofa");
  const bofaSaved = await saveBills(
    beforeBofa.state.bills.map((bill) =>
      bill.id === "bofa" ? { ...bill, amountCents: bill.amountCents + 100 } : bill
    )
  );
  expectEq(
    "leftover follows this-check bill edit",
    bofaSaved.insights.leftoverCheckingCents,
    leftoverWithBofa - 100
  );

  await resetData("real");
  const chatChecking = await applyChatMessage("checking is 0");
  expectEq("chat checking", chatChecking.state.checkingCents, 0);
  expect("chat stamps checking", Boolean(chatChecking.state.checkingUpdatedAt));

  const chatAmex = await applyChatMessage("amex is 1416.35");
  const chatAmexBill = chatAmex.state.bills.find((b) => b.id === "amex");
  expectEq("chat amex amount", chatAmexBill?.amountCents, 141_635);
  expect("chat stamps amex", Boolean(chatAmexBill?.updatedAt));

  const chatDue = await applyChatMessage("amex due 2026-10-15");
  expectEq("chat amex due", chatDue.state.bills.find((b) => b.id === "amex")?.dueDate, "2026-10-15");

  await resetData("real");
  const csvText = await readFile(path.join(process.cwd(), "public/sample-apple-card.csv"), "utf8");
  const imported = await importStatement(csvText);
  expect("import stamps checking", Boolean(imported.state.checkingUpdatedAt));
  expect("import does not wipe bills", imported.state.bills.length === 4);
  const reimport = await importStatement(csvText);
  expectEq("reimport keeps checking as-of", reimport.state.checkingUpdatedAt, imported.state.checkingUpdatedAt);

  await resetData("real");
  const current = await loadState();
  const stripped = {
    ...current,
    checkingUpdatedAt: undefined,
    bills: current.bills.map((bill) => {
      const next = { ...bill };
      delete next.updatedAt;
      return next;
    }),
  } as AppState;
  const saved = await saveState(stripped);
  expectEq("migrate keeps checking", saved.checkingCents, 495_201);
  expectEq("migrate keeps four bills", saved.bills.length, 4);
  expectEq("migrate keeps expenses", saved.expenses.length, 0);
  expect("migrate leaves checking as-of empty", saved.checkingUpdatedAt === undefined);
  expect(
    "migrate leaves bill as-of empty",
    saved.bills.every((bill) => bill.updatedAt === undefined)
  );

  await resetData("real");
  console.log("freshness checks passed: as-of format, saveChecking, saveBills, chat, csv import, migrate");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
