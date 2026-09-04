import { readFile } from "node:fs/promises";
import path from "node:path";
import { importStatement, resetData } from "../lib/actions";
import { UNCATEGORIZED_CATEGORY_ID, normalizeMerchant } from "../lib/categorize";
import { importCsv, importFingerprint } from "../lib/csv";
import { computeInsights } from "../lib/plan";
import { realState } from "../lib/seed";

const TODAY = "2026-08-29";
const STORE = { backend: "file" as const, durable: true, label: "test" };

function expect(label: string, cond: unknown, detail = "") {
  if (!cond) throw new Error(detail ? `${label}: ${detail}` : label);
}

function expectEq(label: string, got: number | string, want: number | string) {
  if (got !== want) throw new Error(`${label}: got ${got}, want ${want}`);
}

const SAMPLE_AMOUNTS = {
  uber: 1_840,
  groceries: 5_412,
  netflix: 1_549,
  chipotle: 1_390,
} as const;
const SAMPLE_TOTAL =
  SAMPLE_AMOUNTS.uber + SAMPLE_AMOUNTS.groceries + SAMPLE_AMOUNTS.netflix + SAMPLE_AMOUNTS.chipotle;

async function main() {
  const csvText = await readFile(path.join(process.cwd(), "public/sample-apple-card.csv"), "utf8");
  const seed = realState(new Date(`${TODAY}T12:00:00-05:00`));
  const before = computeInsights(seed, TODAY, STORE);

  const first = importCsv(seed, csvText, TODAY, `${TODAY}T12:00:00.000Z`);
  expectEq("sample added", first.added.length, 4);
  expectEq("sample payment skipped", first.skipped, 1);
  expectEq("sample duplicates", first.duplicates, 0);
  expectEq("sample errors", first.errors.length, 0);
  expectEq(
    "sample total cents",
    first.added.reduce((sum, e) => sum + e.amountCents, 0),
    SAMPLE_TOTAL
  );

  const byMerchant = Object.fromEntries(first.added.map((e) => [e.merchant, e]));
  expectEq("uber date", byMerchant.UBER?.date ?? "", "2026-08-20");
  expectEq("uber amount", byMerchant.UBER?.amountCents ?? 0, SAMPLE_AMOUNTS.uber);
  expectEq("uber envelope", byMerchant.UBER?.categoryId ?? "", "gas");
  expectEq("whole foods envelope", byMerchant["Whole Foods"]?.categoryId ?? "", "groceries");
  expectEq("whole foods memo", byMerchant["Whole Foods"]?.note ?? "", "WHOLEFDS LINCOLN");
  expectEq("netflix envelope", byMerchant.Netflix?.categoryId ?? "", UNCATEGORIZED_CATEGORY_ID);
  expect("netflix uncategorized auto", byMerchant.Netflix?.autoCategorized === true);
  expectEq("chipotle envelope", byMerchant.Chipotle?.categoryId ?? "", "dining");

  const uberFp = importFingerprint("2026-08-20", SAMPLE_AMOUNTS.uber, "UBER");
  expectEq("fingerprint rule", uberFp, `2026-08-20|${SAMPLE_AMOUNTS.uber}|${normalizeMerchant("UBER")}`);
  expectEq(
    "fingerprint normalizes merchant",
    importFingerprint("2026-08-18", SAMPLE_AMOUNTS.groceries, "whole   foods"),
    importFingerprint("2026-08-18", SAMPLE_AMOUNTS.groceries, "Whole Foods")
  );

  const importedState = {
    ...seed,
    checkingCents: seed.checkingCents - SAMPLE_TOTAL,
    expenses: [...first.added, ...seed.expenses],
  };
  const after = computeInsights(importedState, TODAY, STORE);
  expectEq("checking after import", importedState.checkingCents, seed.checkingCents - SAMPLE_TOTAL);
  expectEq("leftover checking delta", after.leftoverCheckingCents, before.leftoverCheckingCents - SAMPLE_TOTAL);
  expectEq(
    "gas envelope spent",
    after.categories.find((c) => c.id === "gas")?.spentCents ?? 0,
    SAMPLE_AMOUNTS.uber
  );
  expectEq(
    "groceries envelope spent",
    after.categories.find((c) => c.id === "groceries")?.spentCents ?? 0,
    SAMPLE_AMOUNTS.groceries
  );
  expectEq(
    "dining envelope spent",
    after.categories.find((c) => c.id === "dining")?.spentCents ?? 0,
    SAMPLE_AMOUNTS.chipotle
  );
  expectEq(
    "uncategorized/misc envelope spent",
    after.categories.find((c) => c.id === UNCATEGORIZED_CATEGORY_ID)?.spentCents ?? 0,
    SAMPLE_AMOUNTS.netflix
  );

  const second = importCsv(importedState, csvText, TODAY, `${TODAY}T12:00:01.000Z`);
  expectEq("reimport added", second.added.length, 0);
  expectEq("reimport duplicates", second.duplicates, 4);
  expectEq("reimport skipped", second.skipped, 1);

  await resetData("real");
  const live = await importStatement(csvText);
  expectEq("store added", live.importMeta.added, 4);
  expectEq("store skipped", live.importMeta.skipped, 1);
  expectEq("store duplicates", live.importMeta.duplicates, 0);
  expectEq("store checking", live.state.checkingCents, seed.checkingCents - SAMPLE_TOTAL);
  const liveAugust = computeInsights(live.state, TODAY, live.insights.store);
  expectEq(
    "store leftover checking",
    liveAugust.leftoverCheckingCents,
    before.leftoverCheckingCents - SAMPLE_TOTAL
  );

  const replay = await importStatement(csvText);
  expectEq("store reimport added", replay.importMeta.added, 0);
  expectEq("store reimport duplicates", replay.importMeta.duplicates, 4);
  expectEq("store reimport checking unchanged", replay.state.checkingCents, live.state.checkingCents);

  const pasted = await importStatement(csvText.replace(/\n/g, "\r\n"));
  expectEq("paste-equivalent duplicates", pasted.importMeta.duplicates, 4);
  expectEq("paste-equivalent added", pasted.importMeta.added, 0);

  await resetData("real");
  console.log("csv import checks passed");
  console.log(
    `sample: +${first.added.length} purchases, ${first.skipped} payment skipped, checking −${SAMPLE_TOTAL}¢, leftover checking ${after.leftoverCheckingCents}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
