import { readFile } from "node:fs/promises";
import path from "node:path";
import { importStatement, resetData, saveChecking } from "../lib/actions";
import { UNCATEGORIZED_CATEGORY_ID, normalizeMerchant } from "../lib/categorize";
import { importCsv, importFingerprint } from "../lib/csv";
import { computeInsights } from "../lib/plan";
import { realState } from "../lib/seed";

const TODAY = "2026-08-29";
const STORE = { backend: "file" as const, durable: true, label: "test" };
const STAMP = `${TODAY}T12:00:00.000Z`;

function expect(label: string, cond: unknown, detail = "") {
  if (!cond) throw new Error(detail ? `${label}: ${detail}` : label);
}

function expectEq(label: string, got: number | string | undefined, want: number | string | undefined) {
  if (got !== want) throw new Error(`${label}: got ${String(got)}, want ${String(want)}`);
}

const SAMPLE_AMOUNTS = {
  uber: 1_840,
  groceries: 5_412,
  netflix: 1_549,
  chipotle: 1_390,
} as const;
const SAMPLE_TOTAL =
  SAMPLE_AMOUNTS.uber + SAMPLE_AMOUNTS.groceries + SAMPLE_AMOUNTS.netflix + SAMPLE_AMOUNTS.chipotle;
const BOFA_ENDING_CENTS = 465_010;

function assertMappedPurchases(
  label: string,
  added: ReturnType<typeof importCsv>["added"],
  groceryMerchant: string
) {
  expectEq(`${label} added`, added.length, 4);
  const byMerchant = Object.fromEntries(added.map((e) => [e.merchant, e]));
  expectEq(`${label} uber date`, byMerchant.UBER?.date ?? "", "2026-08-20");
  expectEq(`${label} uber amount`, byMerchant.UBER?.amountCents ?? 0, SAMPLE_AMOUNTS.uber);
  expectEq(`${label} uber envelope`, byMerchant.UBER?.categoryId ?? "", "gas");
  expectEq(`${label} grocery envelope`, byMerchant[groceryMerchant]?.categoryId ?? "", "groceries");
  expectEq(`${label} netflix envelope`, byMerchant.Netflix?.categoryId ?? byMerchant["NETFLIX.COM"]?.categoryId ?? "", UNCATEGORIZED_CATEGORY_ID);
  expect(`${label} netflix uncategorized auto`, (byMerchant.Netflix ?? byMerchant["NETFLIX.COM"])?.autoCategorized === true);
  expectEq(`${label} chipotle envelope`, byMerchant.Chipotle?.categoryId ?? byMerchant.CHIPOTLE?.categoryId ?? "", "dining");
  expectEq(
    `${label} total cents`,
    added.reduce((sum, e) => sum + e.amountCents, 0),
    SAMPLE_TOTAL
  );
}

async function readPublic(name: string) {
  return readFile(path.join(process.cwd(), "public", name), "utf8");
}

async function main() {
  const appleText = await readPublic("sample-apple-card.csv");
  const bofaText = await readPublic("sample-bofa.csv");
  const amexText = await readPublic("sample-amex-gold.csv");
  const seed = realState(new Date(`${TODAY}T12:00:00-05:00`));
  const before = computeInsights(seed, TODAY, STORE);

  const first = importCsv(seed, appleText, TODAY, STAMP);
  expectEq("sample added", first.added.length, 4);
  expectEq("sample payment skipped", first.skipped, 1);
  expectEq("sample duplicates", first.duplicates, 0);
  expectEq("sample errors", first.errors.length, 0);
  expect("apple has no checking suggestion", first.suggestedCheckingCents === undefined);
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

  const second = importCsv(importedState, appleText, TODAY, `${TODAY}T12:00:01.000Z`);
  expectEq("reimport added", second.added.length, 0);
  expectEq("reimport duplicates", second.duplicates, 4);
  expectEq("reimport skipped", second.skipped, 1);

  const bofa = importCsv(seed, bofaText, TODAY, STAMP);
  assertMappedPurchases("bofa", bofa.added, "WHOLEFDS LINCOLN");
  expectEq("bofa payment skipped", bofa.skipped, 1);
  expectEq("bofa duplicates", bofa.duplicates, 0);
  expectEq("bofa errors", bofa.errors.length, 0);
  expectEq("bofa suggested checking", bofa.suggestedCheckingCents, BOFA_ENDING_CENTS);
  expect("bofa does not auto-apply checking", true);

  const bofaReplay = importCsv(
    { ...seed, expenses: [...bofa.added, ...seed.expenses] },
    bofaText,
    TODAY,
    `${TODAY}T12:00:01.000Z`
  );
  expectEq("bofa reimport added", bofaReplay.added.length, 0);
  expectEq("bofa reimport duplicates", bofaReplay.duplicates, 4);
  expectEq("bofa reimport skipped", bofaReplay.skipped, 1);

  const amex = importCsv(seed, amexText, TODAY, STAMP);
  assertMappedPurchases("amex", amex.added, "WHOLE FOODS");
  expectEq("amex thank-you skipped", amex.skipped, 1);
  expectEq("amex duplicates", amex.duplicates, 0);
  expect("amex has no checking suggestion", amex.suggestedCheckingCents === undefined);

  const amexReplay = importCsv(
    { ...seed, expenses: [...amex.added, ...seed.expenses] },
    amexText,
    TODAY,
    `${TODAY}T12:00:01.000Z`
  );
  expectEq("amex reimport added", amexReplay.added.length, 0);
  expectEq("amex reimport duplicates", amexReplay.duplicates, 4);

  const bofaCard = importCsv(
    seed,
    [
      "Posted Date,Reference Number,Payee,Address,Amount",
      "08/08/2026,111,CHIPOTLE,CHICAGO IL,-13.90",
      "08/12/2026,112,NETFLIX.COM,,-15.49",
      "08/15/2026,113,BA ELECTRONIC PAYMENT,,200.00",
      "08/18/2026,114,WHOLEFDS LINCOLN,CHICAGO IL,-54.12",
      "08/20/2026,115,UBER,SAN FRANCISCO CA,-18.40",
    ].join("\n"),
    TODAY,
    STAMP
  );
  assertMappedPurchases("bofa card", bofaCard.added, "WHOLEFDS LINCOLN");
  expectEq("bofa card payment skipped", bofaCard.skipped, 1);
  expect("bofa card has no checking suggestion", bofaCard.suggestedCheckingCents === undefined);

  const amexNegativeCharges = importCsv(
    seed,
    [
      "Date,Description,Amount",
      "08/08/2026,CHIPOTLE,-13.90",
      "08/12/2026,NETFLIX.COM,-15.49",
      "08/15/2026,ONLINE PAYMENT - THANK YOU,200.00",
      "08/18/2026,WHOLE FOODS,-54.12",
      "08/20/2026,UBER,-18.40",
    ].join("\n"),
    TODAY,
    STAMP
  );
  assertMappedPurchases("amex inverted", amexNegativeCharges.added, "WHOLE FOODS");
  expectEq("amex inverted payment skipped", amexNegativeCharges.skipped, 1);

  const debitCredit = importCsv(
    seed,
    [
      "Date,Description,Debit,Credit",
      "08/20/2026,UBER,18.40,",
      "08/21/2026,PAYROLL DIRECT DEPOSIT,,2771.55",
    ].join("\n"),
    TODAY,
    STAMP
  );
  expectEq("debit/credit added", debitCredit.added.length, 1);
  expectEq("debit/credit skipped deposit", debitCredit.skipped, 1);
  expectEq("debit/credit uber", debitCredit.added[0]?.amountCents ?? 0, SAMPLE_AMOUNTS.uber);
  expect("debit/credit invents no balance", debitCredit.suggestedCheckingCents === undefined);

  const preambleOnly = importCsv(
    seed,
    [
      "Description,,Summary Amt.",
      'Ending balance as of 08/29/2026,,"4,650.10"',
      "",
      "Date,Description,Amount",
      "08/20/2026,UBER,-18.40",
    ].join("\n"),
    TODAY,
    STAMP
  );
  expectEq("preamble-only added", preambleOnly.added.length, 1);
  expectEq("preamble-only suggested checking", preambleOnly.suggestedCheckingCents, BOFA_ENDING_CENTS);

  const noBalance = importCsv(
    seed,
    ["Date,Description,Amount", "08/20/2026,UBER,-18.40"].join("\n"),
    TODAY,
    STAMP
  );
  expectEq("no-balance added", noBalance.added.length, 1);
  expect("missing balance column is not invented", noBalance.suggestedCheckingCents === undefined);

  await resetData("real");
  const live = await importStatement(appleText);
  expectEq("store added", live.importMeta.added, 4);
  expectEq("store skipped", live.importMeta.skipped, 1);
  expectEq("store duplicates", live.importMeta.duplicates, 0);
  expect("store apple has no checking suggestion", live.importMeta.suggestedCheckingCents === undefined);
  expectEq("store checking", live.state.checkingCents, seed.checkingCents - SAMPLE_TOTAL);
  const liveAugust = computeInsights(live.state, TODAY, live.insights.store);
  expectEq(
    "store leftover checking",
    liveAugust.leftoverCheckingCents,
    before.leftoverCheckingCents - SAMPLE_TOTAL
  );

  const replay = await importStatement(appleText);
  expectEq("store reimport added", replay.importMeta.added, 0);
  expectEq("store reimport duplicates", replay.importMeta.duplicates, 4);
  expectEq("store reimport checking unchanged", replay.state.checkingCents, live.state.checkingCents);

  const pasted = await importStatement(appleText.replace(/\n/g, "\r\n"));
  expectEq("paste-equivalent duplicates", pasted.importMeta.duplicates, 4);
  expectEq("paste-equivalent added", pasted.importMeta.added, 0);

  await resetData("real");
  const liveBofa = await importStatement(bofaText);
  expectEq("store bofa added", liveBofa.importMeta.added, 4);
  expectEq("store bofa skipped", liveBofa.importMeta.skipped, 1);
  expectEq("store bofa suggested checking", liveBofa.importMeta.suggestedCheckingCents, BOFA_ENDING_CENTS);
  expectEq("store bofa checking still subtracted", liveBofa.state.checkingCents, seed.checkingCents - SAMPLE_TOTAL);
  expect("store bofa did not auto-set ending balance", liveBofa.state.checkingCents !== BOFA_ENDING_CENTS);

  const applied = await saveChecking(liveBofa.importMeta.suggestedCheckingCents ?? -1);
  expectEq("saveChecking from statement", applied.state.checkingCents, BOFA_ENDING_CENTS);
  expect("saveChecking stamps as-of", Boolean(applied.state.checkingUpdatedAt));

  await resetData("real");
  const liveAmex = await importStatement(amexText);
  expectEq("store amex added", liveAmex.importMeta.added, 4);
  expectEq("store amex skipped", liveAmex.importMeta.skipped, 1);
  expect("store amex has no checking suggestion", liveAmex.importMeta.suggestedCheckingCents === undefined);

  await resetData("real");
  console.log("csv import checks passed");
  console.log(
    `apple/bofa/amex: +${first.added.length} purchases, payments skipped, checking −${SAMPLE_TOTAL}¢, bofa ending ${BOFA_ENDING_CENTS}¢ optional`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
