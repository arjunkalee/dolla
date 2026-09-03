import { bootstrap, logPurchase, resetData } from "../lib/actions";

async function main() {
  await resetData("real");
  const before = await bootstrap();
  const groc0 = before.insights.categories.find((c) => c.id === "groceries");
  if (!groc0 || groc0.spentCents !== 0) {
    throw new Error(`expected groceries 0 before log, got ${groc0?.spentCents}`);
  }

  const logged = await logPurchase({
    amountCents: 1234,
    merchant: "Test Grocer",
    categoryId: "groceries",
  });
  const groc1 = logged.insights.categories.find((c) => c.id === "groceries");
  if (!groc1 || groc1.spentCents !== 1234) {
    throw new Error(`expected groceries 1234 after log, got ${groc1?.spentCents}`);
  }
  if (!logged.state.expenses.some((e) => e.merchant === "Test Grocer" && e.amountCents === 1234)) {
    throw new Error("logged expense missing from state");
  }

  const reloaded = await bootstrap();
  const groc2 = reloaded.insights.categories.find((c) => c.id === "groceries");
  if (!groc2 || groc2.spentCents !== 1234) {
    throw new Error(`expected groceries 1234 after reload, got ${groc2?.spentCents}`);
  }

  await resetData("real");
  console.log("category persist check passed: $12.34 groceries survived reload");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
