import {
  addDays,
  biweeklyPaydaysAround,
  daysBetween,
  daysInMonth,
  endOfMonth,
  formatLongDate,
  formatMonthLabel,
  lastPaydayOnOrBefore,
  monthKey,
  nextPaydayAfter,
  startOfMonth,
} from "./dates";
import type {
  AppState,
  CalendarEvent,
  CategoryStatus,
  Formula,
  FormulaRow,
  Holdback,
  Insights,
  PaycheckCoverage,
  SavingsId,
  StoreInfo,
  Suggestion,
  UpcomingBill,
} from "./types";

function spentInMonth(state: AppState, month: string, categoryId?: string): number {
  return state.expenses
    .filter((e) => e.date.startsWith(month) && (!categoryId || e.categoryId === categoryId))
    .reduce((sum, e) => sum + e.amountCents, 0);
}

function spentBetween(state: AppState, from: string, toInclusive: string, categoryId?: string): number {
  return state.expenses
    .filter(
      (e) =>
        e.date >= from &&
        e.date <= toInclusive &&
        (!categoryId || e.categoryId === categoryId)
    )
    .reduce((sum, e) => sum + e.amountCents, 0);
}

function sumBills(bills: UpcomingBill[]): number {
  return bills.reduce((sum, b) => sum + b.amountCents, 0);
}

export function computeInsights(
  state: AppState,
  todayISO: string,
  store: StoreInfo
): Insights {
  const month = monthKey(todayISO);
  const monthStart = startOfMonth(todayISO);
  const monthEnd = endOfMonth(todayISO);
  const dim = daysInMonth(todayISO);
  const dayNum = Number(todayISO.slice(8, 10));
  const daysLeftInMonth = Math.max(0, dim - dayNum);
  const lastPayday = lastPaydayOnOrBefore(state.paycheck.anchorDate, todayISO);
  const nextPayday = nextPaydayAfter(state.paycheck.anchorDate, todayISO);
  const daysLeftInPayPeriod = Math.max(1, daysBetween(todayISO, nextPayday));
  const daysElapsedInPayPeriod = Math.max(0, daysBetween(lastPayday, todayISO));
  const horizonEnd = addDays(nextPayday, 21);
  const paydaysThisMonth = biweeklyPaydaysAround(
    state.paycheck.anchorDate,
    monthStart,
    monthEnd
  );
  const remainingPaydaysThisMonth = paydaysThisMonth.filter((d) => d >= todayISO);
  const monthIncomeCents = paydaysThisMonth.length * state.paycheck.netCents;
  const monthBudgetCents = state.categories.reduce(
    (sum, c) => sum + c.monthlyBudgetCents,
    0
  );
  const monthSpentCents = spentInMonth(state, month);

  const categories: CategoryStatus[] = state.categories.map((c) => {
    const spentCents = spentInMonth(state, month, c.id);
    const remainingCents = c.monthlyBudgetCents - spentCents;
    const pct =
      c.monthlyBudgetCents > 0
        ? Math.round((spentCents / c.monthlyBudgetCents) * 100)
        : spentCents > 0
          ? 100
          : 0;
    return {
      id: c.id,
      name: c.name,
      kind: c.kind,
      budgetCents: c.monthlyBudgetCents,
      spentCents,
      remainingCents,
      pct,
      overCents: Math.max(0, spentCents - c.monthlyBudgetCents),
    };
  });

  const unpaidBills = state.bills.filter((b) => !b.paid);
  const thisCheckBills = unpaidBills.filter((b) => b.fromThisCheck);
  const billsAssignedThisCheckCents = sumBills(thisCheckBills);
  const billsRemainingCents = sumBills(unpaidBills);
  const flexibleRemainingCents = categories
    .filter((c) => c.kind === "flexible")
    .reduce((sum, c) => sum + Math.max(0, c.remainingCents), 0);

  const monthlyFlexibleBudget = state.categories
    .filter((c) => c.kind === "flexible")
    .reduce((sum, c) => sum + c.monthlyBudgetCents, 0);
  const twoWeekNeedCents = Math.round(monthlyFlexibleBudget / 2);
  const spentThisPeriodCents = spentBetween(state, lastPayday, todayISO);
  const spentBillsThisPeriod = state.categories
    .filter((c) => c.kind === "bill")
    .reduce((sum, c) => sum + spentBetween(state, lastPayday, todayISO, c.id), 0);
  const spentFlexibleThisPeriod = Math.max(0, spentThisPeriodCents - spentBillsThisPeriod);

  const amex = unpaidBills.find((b) => /amex/i.test(b.name));
  const amexCents = amex?.amountCents ?? 0;
  const amexReserved = Boolean(amex?.fromThisCheck);

  const cardsThisCheck = thisCheckBills.filter((b) => b.kind === "card" && !/amex/i.test(b.name));
  const rentThisCheck = thisCheckBills.filter((b) => b.kind === "rent");
  const otherThisCheck = thisCheckBills.filter(
    (b) => b.kind !== "rent" && !(b.kind === "card" && !/amex/i.test(b.name))
  );

  const cardParts = cardsThisCheck.map((b) => ({
    id: b.id,
    name: b.name,
    cents: b.amountCents,
  }));
  const cardTotalCents = sumBills(cardsThisCheck);
  const twoWeekParts = state.categories
    .filter((c) => c.kind === "flexible")
    .map((c) => ({
      id: c.id,
      name: c.name,
      monthlyCents: c.monthlyBudgetCents,
      halfCents: Math.round(c.monthlyBudgetCents / 2),
    }));
  const twoWeekNeedCentsFixed = twoWeekParts.reduce((sum, p) => sum + p.halfCents, 0);
  const twoWeekVariableFixed = Math.max(0, twoWeekNeedCentsFixed - spentFlexibleThisPeriod);

  const holdbacks: Holdback[] = [];
  if (cardsThisCheck.length) {
    holdbacks.push({
      id: "cards",
      label: cardsThisCheck.map((b) => b.name.replace(/ card$/i, "")).join(" + "),
      cents: cardTotalCents,
      note: cardsThisCheck[0] ? `Due ${formatLongDate(cardsThisCheck[0].dueDate)}` : undefined,
    });
  }
  if (rentThisCheck.length) {
    holdbacks.push({
      id: "rent",
      label: "Rent earmarked",
      cents: sumBills(rentThisCheck),
      note: `Due ${formatLongDate(rentThisCheck[0].dueDate)}`,
    });
  }
  for (const bill of otherThisCheck) {
    holdbacks.push({
      id: bill.id,
      label: `${bill.name} reserved`,
      cents: bill.amountCents,
      note: `Due ${formatLongDate(bill.dueDate)}`,
    });
  }

  const thisCheckMinusAmex = thisCheckBills.filter((b) => !/amex/i.test(b.name));
  const thisCheckMinusAmexCents = sumBills(thisCheckMinusAmex);

  const splitAllocations = state.categories
    .filter((c) => c.kind === "flexible")
    .map((c) => {
      const saved = state.splitAllocations?.find((a) => a.categoryId === c.id);
      return {
        categoryId: c.id,
        name: c.name,
        cents: Math.max(0, saved?.cents ?? 0),
        optedIn: Boolean(saved?.optedIn),
        suggestedCents: Math.round(c.monthlyBudgetCents / 2),
      };
    });
  const optedInParts = splitAllocations.filter((a) => a.optedIn && a.cents > 0);
  const optedInEnvelopeCents = optedInParts.reduce((sum, a) => sum + a.cents, 0);
  const plannedEnvelopeCents = splitAllocations.reduce((sum, a) => sum + a.cents, 0);

  const leftoverPaycheckIfAmexWaitsCents =
    state.paycheck.netCents - thisCheckMinusAmexCents - optedInEnvelopeCents;
  const leftoverPaycheckIfAmexReservedCents =
    leftoverPaycheckIfAmexWaitsCents - amexCents;
  const leftoverPaycheckCents = amexReserved
    ? leftoverPaycheckIfAmexReservedCents
    : leftoverPaycheckIfAmexWaitsCents;

  const leftoverCheckingIfAmexWaitsCents =
    state.checkingCents - thisCheckMinusAmexCents - optedInEnvelopeCents;
  const leftoverCheckingIfAmexReservedCents =
    leftoverCheckingIfAmexWaitsCents - amexCents;
  const leftoverCheckingCents = amexReserved
    ? leftoverCheckingIfAmexReservedCents
    : leftoverCheckingIfAmexWaitsCents;

  const preDepositCheckingCents = state.checkingCents - state.paycheck.netCents;
  const investableThisCheckCents = leftoverCheckingCents;
  const investableIfAmexWaitsCents = leftoverCheckingIfAmexWaitsCents;
  const investableIfAmexReservedCents = leftoverCheckingIfAmexReservedCents;

  const alreadyParkedCents = state.savingsEvents
    .filter((e) => e.date.startsWith(month))
    .reduce((sum, e) => sum + e.amountCents, 0);
  const leftoverMonthCents = monthIncomeCents - monthBudgetCents;
  const availableSavingsCents = Math.max(0, leftoverMonthCents - alreadyParkedCents);
  const perCheckSavings = Math.max(0, investableThisCheckCents);
  const split: Record<SavingsId, number> = {
    etrade: 0,
    roth: 0,
    hysa: 0,
  };

  const flexibleDays = Math.max(1, daysBetween(lastPayday, nextPayday));
  const flexiblePoolThisCheckCents = twoWeekNeedCentsFixed;
  const leftoverThisCheckCents = leftoverPaycheckCents;
  const remainingFlexibleThisPeriod = twoWeekVariableFixed;
  const safeToSpendTodayCents = Math.floor(
    remainingFlexibleThisPeriod / daysLeftInPayPeriod
  );

  const expectedSpendByNow = Math.round(
    ((daysElapsedInPayPeriod + 0.5) / flexibleDays) * twoWeekNeedCents
  );
  const paceRatio =
    expectedSpendByNow > 0 ? spentFlexibleThisPeriod / expectedSpendByNow : 0;
  const onTrack = leftoverPaycheckCents >= 0 && paceRatio <= 1.12;

  let onTrackLabel: string;
  if (leftoverPaycheckCents < 0) {
    onTrackLabel = "This paycheck is short of its holdbacks";
  } else if (paceRatio > 1.12) {
    onTrackLabel = "Spending faster than this paycheck can cover";
  } else if (paceRatio < 0.75 && daysElapsedInPayPeriod >= 2) {
    onTrackLabel = "Ahead of pace this paycheck";
  } else {
    onTrackLabel = "On track this paycheck";
  }

  const nextHorizon = addDays(nextPayday, 14);
  const nextPeriodBills = unpaidBills.filter(
    (b) => !b.fromThisCheck && b.dueDate <= nextHorizon
  );
  const paycheckPlan: PaycheckCoverage[] = [
    {
      date: lastPayday,
      label: `This paycheck · ${formatLongDate(lastPayday)}`,
      isCurrent: true,
      isFuture: false,
      covers: [
        ...thisCheckBills.map((b) => ({
          label: `${b.name} · ${formatLongDate(b.dueDate)}`,
          cents: b.amountCents,
        })),
      ],
      leftoverCents: leftoverPaycheckCents,
      spentSoFarCents: spentThisPeriodCents,
    },
    {
      date: nextPayday,
      label: `Next paycheck · ${formatLongDate(nextPayday)}`,
      isCurrent: false,
      isFuture: true,
      covers: [
        ...nextPeriodBills.map((b) => ({
          label: `${b.name} · ${formatLongDate(b.dueDate)}`,
          cents: b.amountCents,
        })),
      ],
      leftoverCents: state.paycheck.netCents - sumBills(nextPeriodBills),
      spentSoFarCents: 0,
    },
  ];

  const paydaysAround = biweeklyPaydaysAround(
    state.paycheck.anchorDate,
    monthStart,
    horizonEnd
  );
  const calendar: CalendarEvent[] = [
    ...paydaysAround.map((date) => ({
      date,
      kind: "payday" as const,
      label: date === lastPayday ? "Paycheck (already in checking)" : "Paycheck",
      cents: state.paycheck.netCents,
    })),
    ...state.bills.map((b) => ({
      date: b.dueDate,
      kind: "bill" as const,
      label: b.name,
      cents: b.amountCents,
      paid: b.paid,
    })),
    ...state.expenses.map((e) => ({
      date: e.date,
      kind: "spend" as const,
      label: e.merchant,
      cents: e.amountCents,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));

  const formulas = buildFormulas({
    checkingCents: state.checkingCents,
    paycheckNetCents: state.paycheck.netCents,
    preDepositCheckingCents,
    cardParts,
    cardTotalCents,
    rentCents: sumBills(rentThisCheck),
    twoWeekParts,
    twoWeekNeedCents: twoWeekNeedCentsFixed,
    spentFlexibleThisPeriod,
    twoWeekVariableCents: twoWeekVariableFixed,
    optedInParts,
    leftoverPaycheckCents,
    leftoverCheckingCents,
    leftoverPaycheckIfAmexWaitsCents,
    leftoverPaycheckIfAmexReservedCents,
    leftoverCheckingIfAmexWaitsCents,
    leftoverCheckingIfAmexReservedCents,
    amexCents,
    amexReserved,
    categories,
    monthBudgetCents,
    monthSpentCents,
    monthIncomeCents,
    billsRemainingCents,
    unpaidBillParts: unpaidBills.map((b) => ({ name: b.name, cents: b.amountCents })),
    nextPaydayBillParts: nextPeriodBills.map((b) => ({ name: b.name, cents: b.amountCents })),
    nextPaydayBillsCents: sumBills(nextPeriodBills),
    nextPaycheckLeftoverCents: state.paycheck.netCents - sumBills(nextPeriodBills),
    daysLeftInPayPeriod,
    safeToSpendTodayCents,
  });

  const suggestions = buildSuggestions({
    todayISO,
    nextPayday,
    unpaidBills,
    amex,
    amexReserved,
    leftoverPaycheckCents,
    leftoverCheckingCents,
    leftoverCheckingIfAmexReservedCents,
    twoWeekVariableCents: twoWeekVariableFixed,
    categories,
    onTrack,
    safeToSpendTodayCents,
    remainingFlexibleThisPeriod,
    daysLeftInPayPeriod,
    paceRatio,
  });

  return {
    todayISO,
    monthKey: month,
    monthLabel: formatMonthLabel(todayISO),
    daysInMonth: dim,
    daysLeftInMonth,
    lastPayday,
    nextPayday,
    daysLeftInPayPeriod,
    daysElapsedInPayPeriod,
    paycheckNetCents: state.paycheck.netCents,
    paydaysThisMonth,
    remainingPaydaysThisMonth,
    monthIncomeCents,
    monthBudgetCents,
    monthSpentCents,
    monthRemainingCents: monthBudgetCents - monthSpentCents,
    spentThisPeriodCents,
    billsRemainingCents,
    flexibleRemainingCents,
    billsAssignedThisCheckCents,
    savingsSuggestedThisCheckCents: perCheckSavings,
    flexiblePoolThisCheckCents,
    leftoverThisCheckCents,
    leftoverPaycheckCents,
    leftoverCheckingCents,
    leftoverPaycheckIfAmexWaitsCents,
    leftoverPaycheckIfAmexReservedCents,
    leftoverCheckingIfAmexWaitsCents,
    leftoverCheckingIfAmexReservedCents,
    preDepositCheckingCents,
    cardTotalCents,
    cardParts,
    twoWeekParts,
    formulas,
    safeToSpendTodayCents,
    onTrack,
    onTrackLabel,
    paceRatio,
    categories,
    suggestions,
    paycheckPlan,
    calendar,
    holdbacks,
    investableThisCheckCents,
    investableIfAmexWaitsCents,
    investableIfAmexReservedCents,
    amexReserved,
    amexCents,
    twoWeekVariableCents: twoWeekVariableFixed,
    twoWeekNeedCents: twoWeekNeedCentsFixed,
    optedInEnvelopeCents,
    splitPlayLeftoverCents:
      leftoverPaycheckCents - (plannedEnvelopeCents - optedInEnvelopeCents),
    splitAllocations,
    checkingCents: state.checkingCents,
    savingsSuggestion: {
      leftoverMonthCents,
      alreadyParkedCents,
      availableCents: availableSavingsCents,
      perCheckCents: perCheckSavings,
      split,
    },
    store,
  };
}

function formula(id: string, title: string, rows: FormulaRow[]): Formula {
  const result = rows.find((r) => r.role === "total")?.cents ?? 0;
  return { id, title, resultCents: result, rows };
}

function buildFormulas(input: {
  checkingCents: number;
  paycheckNetCents: number;
  preDepositCheckingCents: number;
  cardParts: { id: string; name: string; cents: number }[];
  cardTotalCents: number;
  rentCents: number;
  twoWeekParts: { id: string; name: string; monthlyCents: number; halfCents: number }[];
  twoWeekNeedCents: number;
  spentFlexibleThisPeriod: number;
  twoWeekVariableCents: number;
  optedInParts: { name: string; cents: number }[];
  leftoverPaycheckCents: number;
  leftoverCheckingCents: number;
  leftoverPaycheckIfAmexWaitsCents: number;
  leftoverPaycheckIfAmexReservedCents: number;
  leftoverCheckingIfAmexWaitsCents: number;
  leftoverCheckingIfAmexReservedCents: number;
  amexCents: number;
  amexReserved: boolean;
  categories: CategoryStatus[];
  monthBudgetCents: number;
  monthSpentCents: number;
  monthIncomeCents: number;
  billsRemainingCents: number;
  unpaidBillParts: { name: string; cents: number }[];
  nextPaydayBillParts: { name: string; cents: number }[];
  nextPaydayBillsCents: number;
  nextPaycheckLeftoverCents: number;
  daysLeftInPayPeriod: number;
  safeToSpendTodayCents: number;
}): Record<string, Formula> {
  const cardRows: FormulaRow[] = input.cardParts.flatMap((p, i) => [
    {
      label: p.name,
      cents: p.cents,
      role: i === 0 ? "start" : "plus",
    },
  ]);
  if (input.cardParts.length) {
    cardRows.push({ label: "Cards this paycheck", cents: input.cardTotalCents, role: "total" });
  }

  const twoWeekRows: FormulaRow[] = input.twoWeekParts.map((p, i) => ({
    label: `${p.name} ${formatPlain(p.monthlyCents)} ÷ 2`,
    cents: p.halfCents,
    role: i === 0 ? "start" : "plus",
  }));
  twoWeekRows.push({
    label: "Two-week envelopes",
    cents: input.twoWeekNeedCents,
    role: "total",
  });
  if (input.spentFlexibleThisPeriod > 0) {
    twoWeekRows.splice(twoWeekRows.length - 1, 0, {
      label: "Already spent this period",
      cents: input.spentFlexibleThisPeriod,
      role: "minus",
    });
    twoWeekRows[twoWeekRows.length - 1] = {
      label: "Two-week holdback left",
      cents: input.twoWeekVariableCents,
      role: "total",
    };
  }

  const optedRows = input.optedInParts.map((p) => ({
    label: `${p.name} (on Split)`,
    cents: p.cents,
    role: "minus" as const,
  }));

  const paycheckRows: FormulaRow[] = [
    { label: "This paycheck (net)", cents: input.paycheckNetCents, role: "start" },
    ...input.cardParts.map((p) => ({ label: p.name, cents: p.cents, role: "minus" as const })),
    ...(input.rentCents ? [{ label: "Rent", cents: input.rentCents, role: "minus" as const }] : []),
    ...optedRows,
    ...(input.amexReserved
      ? [{ label: "Amex reserved", cents: input.amexCents, role: "minus" as const }]
      : []),
    { label: "Left from this paycheck", cents: input.leftoverPaycheckCents, role: "total" },
  ];

  const checkingRows: FormulaRow[] = [
    { label: "Checking (includes this paycheck)", cents: input.checkingCents, role: "start" },
    ...input.cardParts.map((p) => ({ label: p.name, cents: p.cents, role: "minus" as const })),
    ...(input.rentCents ? [{ label: "Rent", cents: input.rentCents, role: "minus" as const }] : []),
    ...optedRows,
    ...(input.amexReserved
      ? [{ label: "Amex reserved", cents: input.amexCents, role: "minus" as const }]
      : []),
    { label: "Left in checking", cents: input.leftoverCheckingCents, role: "total" },
  ];

  const priorRows: FormulaRow[] = [
    { label: "Checking now", cents: input.checkingCents, role: "start" },
    { label: "This paycheck (already deposited)", cents: input.paycheckNetCents, role: "minus" },
    { label: "Already in checking before deposit", cents: input.preDepositCheckingCents, role: "total" },
  ];

  const amexWaitPay: FormulaRow[] = [
    { label: "This paycheck", cents: input.paycheckNetCents, role: "start" },
    ...input.cardParts.map((p) => ({ label: p.name, cents: p.cents, role: "minus" as const })),
    ...(input.rentCents ? [{ label: "Rent", cents: input.rentCents, role: "minus" as const }] : []),
    ...optedRows,
    { label: "Paycheck leftover if Amex waits", cents: input.leftoverPaycheckIfAmexWaitsCents, role: "total" },
  ];
  const amexNowPay: FormulaRow[] = [
    ...amexWaitPay.slice(0, -1),
    { label: "Amex reserved now", cents: input.amexCents, role: "minus" },
    { label: "Paycheck leftover if Amex reserved", cents: input.leftoverPaycheckIfAmexReservedCents, role: "total" },
  ];
  const amexWaitChk: FormulaRow[] = [
    { label: "Checking", cents: input.checkingCents, role: "start" },
    ...input.cardParts.map((p) => ({ label: p.name, cents: p.cents, role: "minus" as const })),
    ...(input.rentCents ? [{ label: "Rent", cents: input.rentCents, role: "minus" as const }] : []),
    ...optedRows,
    { label: "Checking leftover if Amex waits", cents: input.leftoverCheckingIfAmexWaitsCents, role: "total" },
  ];
  const amexNowChk: FormulaRow[] = [
    ...amexWaitChk.slice(0, -1),
    { label: "Amex reserved now", cents: input.amexCents, role: "minus" },
    { label: "Checking leftover if Amex reserved", cents: input.leftoverCheckingIfAmexReservedCents, role: "total" },
  ];

  const out: Record<string, Formula> = {
    cards: formula("cards", "Cards this paycheck", cardRows),
    twoWeek: formula("twoWeek", "Two-week plan (not deducted)", twoWeekRows),
    paycheck: formula("paycheck", "Left from this paycheck", paycheckRows),
    checking: formula("checking", "Left in checking", checkingRows),
    prior: formula("prior", "Cash already in checking", priorRows),
    amexWaitPaycheck: formula("amexWaitPaycheck", "Paycheck leftover · Amex next check", amexWaitPay),
    amexNowPaycheck: formula("amexNowPaycheck", "Paycheck leftover · Amex reserved", amexNowPay),
    amexWaitChecking: formula("amexWaitChecking", "Checking leftover · Amex next check", amexWaitChk),
    amexNowChecking: formula("amexNowChecking", "Checking leftover · Amex reserved", amexNowChk),
    monthEnvelopes: formula("monthEnvelopes", "Monthly envelopes", [
      ...input.categories.map((c, i) => ({
        label: c.name,
        cents: c.budgetCents,
        role: (i === 0 ? "start" : "plus") as FormulaRow["role"],
      })),
      { label: "Monthly envelope total", cents: input.monthBudgetCents, role: "total" },
    ]),
    monthSpent: formula("monthSpent", "Spent vs envelopes", [
      { label: "Monthly envelopes", cents: input.monthBudgetCents, role: "start" },
      { label: "Logged this month", cents: input.monthSpentCents, role: "minus" },
      { label: "Envelope remaining", cents: input.monthBudgetCents - input.monthSpentCents, role: "total" },
    ]),
    monthLeftover: formula("monthLeftover", "Month leftover after envelopes", [
      { label: "Paychecks this month", cents: input.monthIncomeCents, role: "start" },
      { label: "Monthly envelopes", cents: input.monthBudgetCents, role: "minus" },
      { label: "Left after envelopes", cents: input.monthIncomeCents - input.monthBudgetCents, role: "total" },
    ]),
    unpaidBills: formula("unpaidBills", "Unpaid bills", [
      ...input.unpaidBillParts.map((b, i) => ({
        label: b.name,
        cents: b.cents,
        role: (i === 0 ? "start" : "plus") as FormulaRow["role"],
      })),
      { label: "Unpaid bills", cents: input.billsRemainingCents, role: "total" },
    ]),
    nextPaycheck: formula("nextPaycheck", "Left from next paycheck", [
      { label: "Next paycheck (net)", cents: input.paycheckNetCents, role: "start" },
      ...input.nextPaydayBillParts.map((b) => ({
        label: b.name,
        cents: b.cents,
        role: "minus" as const,
      })),
      { label: "Left from next paycheck", cents: input.nextPaycheckLeftoverCents, role: "total" },
    ]),
    dailyPace: formula("dailyPace", "Variable pace until payday", [
      { label: "Two-week envelopes left", cents: input.twoWeekVariableCents, role: "start" },
      {
        label: `÷ ${input.daysLeftInPayPeriod} days left this pay period`,
        cents: input.safeToSpendTodayCents,
        role: "total",
      },
    ]),
  };

  for (const c of input.categories) {
    out[`envelope-${c.id}`] = formula(`envelope-${c.id}`, c.name, [
      { label: "Monthly envelope", cents: c.budgetCents, role: "start" },
      { label: "Logged this month", cents: c.spentCents, role: "minus" },
      { label: "Remaining", cents: c.remainingCents, role: "total" },
    ]);
  }

  return out;
}

function buildSuggestions(input: {
  todayISO: string;
  nextPayday: string;
  unpaidBills: UpcomingBill[];
  amex: UpcomingBill | undefined;
  amexReserved: boolean;
  leftoverPaycheckCents: number;
  leftoverCheckingCents: number;
  leftoverCheckingIfAmexReservedCents: number;
  twoWeekVariableCents: number;
  categories: CategoryStatus[];
  onTrack: boolean;
  safeToSpendTodayCents: number;
  remainingFlexibleThisPeriod: number;
  daysLeftInPayPeriod: number;
  paceRatio: number;
}): Suggestion[] {
  const items: Suggestion[] = [];
  const cardsTomorrow = input.unpaidBills.filter(
    (b) => b.kind === "card" && !/amex/i.test(b.name) && b.dueDate <= addDays(input.todayISO, 1)
  );
  if (cardsTomorrow.length) {
    items.push({
      id: "pay-cards",
      tone: "now",
      title: "Pay the two cards tomorrow",
      detail: `${cardsTomorrow.map((b) => `${b.name} ${formatPlain(b.amountCents)}`).join(" and ")}. They’re due ${formatLongDate(cardsTomorrow[0].dueDate)}.`,
    });
  }

  const rent = input.unpaidBills.find((b) => b.kind === "rent");
  if (rent) {
    items.push({
      id: "earmark-rent",
      tone: "now",
      title: "Earmark rent",
      detail: `${formatPlain(rent.amountCents)} due ${formatLongDate(rent.dueDate)}. Keep it in checking until you pay — don’t invest it.`,
    });
  }

  items.push({
    id: "fund-variable",
    tone: "good",
    title: "Two-week envelopes are a plan, not a deduction",
    detail: `A ${formatPlain(input.twoWeekVariableCents)} two-week plan lives on Split. Leftover does not subtract it unless you opt those envelopes in.`,
  });

  if (input.amex && !input.amex.paid) {
    items.push({
      id: "amex",
      tone: input.amexReserved ? "warn" : "save",
      title: input.amexReserved
        ? "Amex is reserved from this check"
        : "Pay Amex from the next paycheck",
      detail: input.amexReserved
        ? `Holding ${formatPlain(input.amex.amountCents)} now. Checking leftover becomes ${formatPlain(input.leftoverCheckingIfAmexReservedCents)}.`
        : `${formatPlain(input.amex.amountCents)} is due ${formatLongDate(input.amex.dueDate)}, 5 days after ${formatLongDate(input.nextPayday)}. Default: next paycheck.`,
    });
  }

  if (input.leftoverPaycheckCents < 0) {
    items.push({
      id: "paycheck-short",
      tone: "warn",
      title: `This paycheck is short ${formatPlain(Math.abs(input.leftoverPaycheckCents))}`,
      detail: `Paycheck minus cards and rent actually due from this check. Checking leftover ${formatPlain(input.leftoverCheckingCents)} is prior cash, not this deposit.`,
    });
  }

  if (input.leftoverCheckingCents > 0) {
    items.push({
      id: "invest",
      tone: "save",
      title: `${formatPlain(input.leftoverCheckingCents)} left in checking after holdbacks`,
      detail: "Not leftover from this paycheck. Prior cash plus the deposit, minus cards and rent due from this check.",
    });
  }

  const over = input.categories.filter((c) => c.overCents > 0);
  for (const cat of over) {
    items.push({
      id: `over-${cat.id}`,
      tone: "cut",
      title: `${cat.name} is over budget`,
      detail: `Over by ${formatPlain(cat.overCents)}.`,
    });
  }

  if (input.paceRatio > 1.12) {
    items.push({
      id: "pace",
      tone: "warn",
      title: "Slow down until next payday",
      detail: `Daily pace is ${formatPlain(input.safeToSpendTodayCents)}.`,
    });
  }

  return items.slice(0, 6);
}

export function leftoverSummary(insights: Insights): string {
  const pay = insights.formulas.paycheck;
  const chk = insights.formulas.checking;
  const cards = insights.formulas.cards;
  return [
    cards ? formulaToText(cards) : "",
    pay ? formulaToText(pay) : "",
    chk ? formulaToText(chk) : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function formulaToText(f: Formula): string {
  return f.rows
    .map((r) => {
      const op =
        r.role === "minus" ? "−" : r.role === "plus" ? "+" : r.role === "total" ? "=" : " ";
      return `${op} ${r.label}  ${formatPlain(r.cents)}`;
    })
    .join("\n");
}

function formatPlain(cents: number): string {
  const abs = Math.abs(cents) / 100;
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(abs);
  return cents < 0 ? `−${formatted}` : formatted;
}
