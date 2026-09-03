import { dollarsToCents } from "./money";
import type { AppState, CategoryId } from "./types";

export type ChatIntent =
  | { type: "set-checking"; cents: number }
  | { type: "set-paycheck"; cents: number }
  | { type: "set-category"; id: CategoryId; cents: number }
  | { type: "set-rent-both"; cents: number }
  | { type: "set-bill-amount"; billId: string; cents: number }
  | { type: "set-bill-due"; billId: string; date: string }
  | { type: "set-bill-paid"; billId: string; paid: boolean }
  | { type: "set-from-check"; billId: string; fromThisCheck: boolean }
  | { type: "log-expense"; cents: number; merchant: string; categoryId?: CategoryId }
  | { type: "ask-wipe"; mode: "real" | "empty" }
  | { type: "confirm-wipe" }
  | { type: "cancel-wipe" }
  | { type: "help" }
  | { type: "unknown" };

const CATEGORY_ALIASES: Array<{ keys: RegExp; id: CategoryId }> = [
  { keys: /\brent\b/, id: "rent" },
  { keys: /\bgas\b|fuel/, id: "gas" },
  { keys: /\bgrocer/, id: "groceries" },
  { keys: /\bdining\b|\brestaurant|\beating\b/, id: "dining" },
  { keys: /\bweekend/, id: "weekends" },
  { keys: /\butilit|\belectric/, id: "utilities" },
  { keys: /\btravel\b|\btrip\b/, id: "travel" },
  { keys: /\bmisc\b|\bother\b/, id: "misc" },
];

function moneyIn(text: string): number | null {
  const match = text.match(/\$?\s*(-?[\d,]+(?:\.\d{1,2})?)/);
  if (!match) return null;
  const cents = dollarsToCents(match[1]);
  return Number.isFinite(cents) ? cents : null;
}

function findBillId(text: string, state: AppState): string | null {
  if (/\bamex\b|american express/.test(text)) return idIfExists(state, "amex") ?? nameMatch(state, /amex/);
  if (/\bapple\b/.test(text)) return idIfExists(state, "apple-card") ?? nameMatch(state, /apple/);
  if (/\bbofa\b|\bboa\b|bank of america/.test(text)) return idIfExists(state, "bofa") ?? nameMatch(state, /bank of america|bofa/);
  if (/\brent\b/.test(text)) return idIfExists(state, "rent") ?? nameMatch(state, /\brent\b/);
  return null;
}

function idIfExists(state: AppState, id: string): string | null {
  return state.bills.some((b) => b.id === id) ? id : null;
}

function nameMatch(state: AppState, re: RegExp): string | null {
  return state.bills.find((b) => re.test(b.name.toLowerCase()))?.id ?? null;
}

function findCategory(text: string): CategoryId | null {
  for (const row of CATEGORY_ALIASES) {
    if (row.keys.test(text)) return row.id;
  }
  return null;
}

function parseDate(text: string): string | null {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const us = text.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (us) {
    const year = us[3] ? (us[3].length === 2 ? `20${us[3]}` : us[3]) : "2026";
    return `${year}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  }
  const months: Record<string, string> = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    sept: "09",
    oct: "10",
    nov: "11",
    dec: "12",
  };
  const named = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:\s*,?\s*(20\d{2}))?/i
  );
  if (named) {
    const key = named[1].slice(0, 4).toLowerCase().replace("sept", "sep").slice(0, 3);
    const month = months[key];
    if (month) {
      const year = named[3] ?? "2026";
      return `${year}-${month}-${named[2].padStart(2, "0")}`;
    }
  }
  return null;
}

export function parseChat(raw: string, state: AppState): ChatIntent {
  const text = raw.trim().toLowerCase().replace(/[’']/g, "'");
  if (!text) return { type: "unknown" };

  if (state.chatPending && /^(yes|y|confirm|confirm reset|do it|ok)$/i.test(raw.trim())) {
    return { type: "confirm-wipe" };
  }
  if (state.chatPending && /^(no|n|cancel|nevermind|never mind)$/i.test(raw.trim())) {
    return { type: "cancel-wipe" };
  }

  if (/\b(help|what can you|commands)\b/.test(text)) return { type: "help" };

  if (/\b(reload starting|reset ledger|restore snapshot|wipe (it )?all)\b/.test(text)) {
    return { type: "ask-wipe", mode: "real" };
  }
  if (/\b(blank month|start over|empty ledger)\b/.test(text)) {
    return { type: "ask-wipe", mode: "empty" };
  }

  if (/\b(don't |do not |dont )?(reserve )?amex\b.*\b(next|wait)/.test(text) || /\bamex\b.*\bnext (paycheck|check)\b/.test(text)) {
    const id = findBillId(text, state);
    if (id) return { type: "set-from-check", billId: id, fromThisCheck: false };
  }
  if (/\breserve amex\b|\bamex\b.*\b(this (paycheck|check)|now|from this)\b/.test(text)) {
    const id = findBillId(text, state);
    if (id) return { type: "set-from-check", billId: id, fromThisCheck: true };
  }

  if (/\b(unpaid|not paid|mark unpaid)\b/.test(text)) {
    const id = findBillId(text, state);
    if (id) return { type: "set-bill-paid", billId: id, paid: false };
  }
  if (/\b(is paid|mark paid|paid)\b/.test(text) && findBillId(text, state)) {
    const id = findBillId(text, state);
    if (id) return { type: "set-bill-paid", billId: id, paid: true };
  }

  if (/\bdue\b/.test(text)) {
    const id = findBillId(text, state);
    const date = parseDate(text);
    if (id && date) return { type: "set-bill-due", billId: id, date };
  }

  if (/\bchecking\b/.test(text)) {
    const cents = moneyIn(text);
    if (cents !== null) return { type: "set-checking", cents };
  }

  if (/\bpaycheck\b|\bpay ?check\b/.test(text)) {
    const cents = moneyIn(text);
    if (cents !== null) return { type: "set-paycheck", cents };
  }

  const billId = findBillId(text, state);
  const categoryId = findCategory(text);
  const cents = moneyIn(text);
  const wantsBudget = /\benvelope\b|\bbudget\b|\bmonthly\b|\bchange\b.+\bto\b|\bset\b.+\bto\b/.test(text);

  if (cents !== null && categoryId && wantsBudget) {
    if (categoryId === "rent") return { type: "set-rent-both", cents };
    return { type: "set-category", id: categoryId, cents };
  }

  if (cents !== null && cents > 0 && (/\b(log|spent|spend|for|on)\b/.test(text) || (categoryId && !wantsBudget))) {
    if (billId && billId !== "rent" && !/\b(log|spent|spend|for|on)\b/.test(text) && !categoryId) {
      return { type: "set-bill-amount", billId, cents };
    }
    if (categoryId || /\b(log|spent|spend)\b/.test(text)) {
      const at = raw.match(/\b(?:at|from)\s+(.+?)(?:\s+for\s+|\s+on\s+|$)/i);
      const merchant = (at?.[1] ?? (categoryId
        ? state.categories.find((c) => c.id === categoryId)?.name ?? categoryId
        : "Manual")).replace(/\s+/g, " ").trim();
      return { type: "log-expense", cents, merchant, categoryId: categoryId ?? undefined };
    }
  }

  if (cents !== null && billId === "rent" && wantsBudget) {
    return { type: "set-rent-both", cents };
  }
  if (cents !== null && billId && billId !== "rent") {
    return { type: "set-bill-amount", billId, cents };
  }

  return { type: "unknown" };
}
