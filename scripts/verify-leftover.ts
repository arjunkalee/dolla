import { applyChatMessage, resetData } from "../lib/actions";
import { computeInsights } from "../lib/plan";
import { realState } from "../lib/seed";
import { parseChat } from "../lib/chat";

const today = "2026-08-29";
const store = { backend: "file" as const, durable: true, label: "test" };
const insights = computeInsights(realState(new Date(`${today}T12:00:00-05:00`)), today, store);

const expectEq = (label: string, got: number, want: number) => {
  if (got !== want) {
    throw new Error(`${label}: got ${got}, want ${want}`);
  }
};

expectEq("paycheck leftover", insights.leftoverPaycheckCents, 19_054);
expectEq("checking leftover", insights.leftoverCheckingCents, 237_100);
expectEq("checking if Amex reserved", insights.leftoverCheckingIfAmexReservedCents, 95_448);
expectEq("paycheck if Amex reserved", insights.leftoverPaycheckIfAmexReservedCents, -122_598);
expectEq("cards", insights.cardTotalCents, 114_901);
expectEq("two-week plan", insights.twoWeekNeedCents, 67_500);
expectEq("opted-in envelopes", insights.optedInEnvelopeCents, 0);
expectEq("Amex default off", insights.amexReserved ? 1 : 0, 0);
expectEq("pre-deposit checking", insights.preDepositCheckingCents, 218_046);

const state = realState();
if (parseChat("checking is 5100", state).type !== "set-checking") throw new Error("checking parse");
if (parseChat("change rent to 1450", state).type !== "set-rent-both") throw new Error("rent envelope parse");
if (parseChat("Apple Card is paid", state).type !== "set-bill-paid") throw new Error("apple paid parse");
if (parseChat("change groceries to 300", state).type !== "set-category") throw new Error("groceries parse");
if (parseChat("restaurant envelope is 400", state).type !== "set-category") throw new Error("restaurant budget parse");
if (parseChat("paycheck is 2771.55", state).type !== "set-paycheck") throw new Error("paycheck parse");

for (const phrase of ["$10 for restaurant", "10 for restaurant", "restaurant 10"]) {
  const intent = parseChat(phrase, state);
  if (intent.type !== "log-expense" || intent.cents !== 1000 || intent.categoryId !== "dining") {
    throw new Error(`expected log $10 dining from "${phrase}", got ${JSON.stringify(intent)}`);
  }
}

async function main() {
  await resetData("real");
  const chatLog = await applyChatMessage("$10 for restaurant");
  const dining = chatLog.state.categories.find((c) => c.id === "dining");
  const spent = chatLog.insights.categories.find((c) => c.id === "dining");
  if (!dining || dining.monthlyBudgetCents !== 40_000) {
    throw new Error(`dining envelope should stay 40000, got ${dining?.monthlyBudgetCents}`);
  }
  if (!spent || spent.spentCents !== 1000) {
    throw new Error(`dining spent should be 1000, got ${spent?.spentCents}`);
  }
  if (!chatLog.state.expenses.some((e) => e.categoryId === "dining" && e.amountCents === 1000)) {
    throw new Error("missing dining expense from $10 for restaurant");
  }
  await resetData("real");

  console.log("leftover + chat parser checks passed");
  console.log(insights.formulas.paycheck.rows.map((r) => `${r.role} ${r.label} ${r.cents}`).join("\n"));
  console.log("---");
  console.log(insights.formulas.checking.rows.map((r) => `${r.role} ${r.label} ${r.cents}`).join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
