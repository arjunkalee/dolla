import {
  mapImportedCategory,
  normalizeMerchant,
  suggestCategory,
  UNCATEGORIZED_CATEGORY_ID,
} from "./categorize";
import { dollarsToCents } from "./money";
import { nanoid } from "nanoid";
import type { AppState, CategoryId, Expense } from "./types";

export type CsvImportMeta = {
  added: number;
  skipped: number;
  duplicates: number;
  errors: string[];
  /** Present only when the file itself included an ending/available/running balance. */
  suggestedCheckingCents?: number;
};

export type CsvImportResult = {
  added: Expense[];
  skipped: number;
  duplicates: number;
  errors: string[];
  suggestedCheckingCents?: number;
};

type AmountConvention = "debit-negative" | "charge-positive";

const DATE_HEADERS = ["transaction date", "trans date", "posted date", "clearing date", "date"];
const MERCHANT_HEADERS = ["merchant", "description", "name", "payee"];
const DESC_HEADERS = ["description", "memo", "note", "extended details"];
const AMOUNT_HEADERS = ["amount (usd)", "amount", "charge"];
const BALANCE_HEADERS = [
  "running bal",
  "running balance",
  "available balance",
  "available bal",
  "ending balance",
];

const PAYMENT_OR_CREDIT =
  /thank\s*you|apple card payment|autopay|credit card (bill )?payment|online payment|payment received|electronic payment|bill payment|mobile payment|card payment|\bpayment\b|\bpmt\b|\brefund\b|statement credit|\bcash ?back\b|direct deposit|\bdeposit\b|interest earned|interest paid|payroll/i;

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  const input = text.replace(/^\uFEFF/, "");

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    const next = input[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
      cell = "";
    } else if (ch === "\r") {
      continue;
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}

function headerIndex(headers: string[], candidates: string[]): number {
  const normalized = headers.map((h) => h.trim().toLowerCase());
  for (const candidate of candidates) {
    const i = normalized.findIndex((h) => {
      if (/summary/.test(h)) return false;
      return h === candidate || h.includes(candidate);
    });
    if (i >= 0) return i;
  }
  return -1;
}

function looksLikeHeader(headers: string[]): boolean {
  const dateIdx = headerIndex(headers, DATE_HEADERS);
  const merchantIdx = headerIndex(headers, MERCHANT_HEADERS);
  const amountIdx = headerIndex(headers, AMOUNT_HEADERS);
  const debitIdx = headerIndex(headers, ["debit"]);
  const creditIdx = headerIndex(headers, ["credit"]);
  return dateIdx >= 0 && merchantIdx >= 0 && (amountIdx >= 0 || debitIdx >= 0 || creditIdx >= 0);
}

function findHeaderRowIndex(rows: string[][]): number {
  const limit = Math.min(rows.length, 30);
  for (let i = 0; i < limit; i++) {
    if (looksLikeHeader(rows[i])) return i;
  }
  return -1;
}

function parseDateCell(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (us) {
    const month = us[1].padStart(2, "0");
    const day = us[2].padStart(2, "0");
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, "0");
    const d = String(parsed.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return null;
}

function looksLikeMoney(raw: string): boolean {
  return /\d/.test(raw);
}

function parseMoneyCell(raw: string): number {
  return dollarsToCents(raw);
}

function parseSignedAmountCents(
  row: string[],
  amountIdx: number,
  debitIdx: number,
  creditIdx: number
): number {
  if (debitIdx >= 0 && creditIdx >= 0 && debitIdx !== creditIdx) {
    const debitRaw = row[debitIdx] ?? "";
    const creditRaw = row[creditIdx] ?? "";
    const debit = looksLikeMoney(debitRaw) ? Math.abs(parseMoneyCell(debitRaw)) : 0;
    const credit = looksLikeMoney(creditRaw) ? Math.abs(parseMoneyCell(creditRaw)) : 0;
    if (debit > 0 && credit === 0) return -debit;
    if (credit > 0 && debit === 0) return credit;
    return 0;
  }
  if (amountIdx >= 0 && looksLikeMoney(row[amountIdx] ?? "")) {
    return parseMoneyCell(row[amountIdx] ?? "0");
  }
  if (debitIdx >= 0 && looksLikeMoney(row[debitIdx] ?? "")) {
    const n = Math.abs(parseMoneyCell(row[debitIdx] ?? "0"));
    return n ? -n : 0;
  }
  if (creditIdx >= 0 && looksLikeMoney(row[creditIdx] ?? "")) {
    return Math.abs(parseMoneyCell(row[creditIdx] ?? "0"));
  }
  return 0;
}

function isPaymentOrCredit(type: string, desc: string, merchant: string): boolean {
  const blob = `${type} ${desc} ${merchant}`;
  if (PAYMENT_OR_CREDIT.test(blob)) return true;
  if (type && /payment|credit|refund|\bcr\b/.test(type) && !/purchase/.test(type)) return true;
  return false;
}

function hasAmexHeaders(headers: string[]): boolean {
  const normalized = headers.map((h) => h.trim().toLowerCase());
  return normalized.some(
    (h) =>
      h.includes("card member") ||
      h.includes("appears on your statement") ||
      h === "account #" ||
      h.includes("account #")
  );
}

function detectAmountConvention(
  headers: string[],
  typeIdx: number,
  debitIdx: number,
  creditIdx: number,
  balanceIdx: number,
  dataRows: string[][],
  amountIdx: number,
  merchantIdx: number,
  descIdx: number
): AmountConvention {
  if (hasAmexHeaders(headers)) return "charge-positive";
  if (balanceIdx >= 0) return "debit-negative";
  if (debitIdx >= 0 && creditIdx >= 0 && debitIdx !== creditIdx) return "debit-negative";
  if (headerIndex(headers, ["reference number"]) >= 0) return "debit-negative";
  if (typeIdx >= 0) return "debit-negative";

  let pos = 0;
  let neg = 0;
  for (const row of dataRows) {
    const type = typeIdx >= 0 ? (row[typeIdx] ?? "").toLowerCase() : "";
    const desc = (row[descIdx >= 0 ? descIdx : merchantIdx] ?? "").trim();
    const merchant = (row[merchantIdx] ?? desc).trim() || "Unknown";
    if (isPaymentOrCredit(type, desc, merchant)) continue;
    const signed = parseSignedAmountCents(row, amountIdx, debitIdx, creditIdx);
    if (signed > 0) pos += 1;
    else if (signed < 0) neg += 1;
  }
  if (pos > neg) return "charge-positive";
  return "debit-negative";
}

function parsePreambleBalance(rows: string[][], headerRowIndex: number): number | undefined {
  for (let i = 0; i < headerRowIndex; i++) {
    const joined = rows[i].join(" ");
    if (!/ending balance|available balance/i.test(joined)) continue;
    if (/beginning/.test(joined.toLowerCase())) continue;
    for (let j = rows[i].length - 1; j >= 0; j--) {
      const raw = rows[i][j] ?? "";
      if (looksLikeMoney(raw)) return parseMoneyCell(raw);
    }
  }
  return undefined;
}

function emptyResult(errors: string[]): CsvImportResult {
  return { added: [], skipped: 0, duplicates: 0, errors };
}

/** Duplicate key: `date|amountCents|normalizedMerchant` (see `normalizeMerchant`). */
export function importFingerprint(date: string, amountCents: number, merchant: string): string {
  const normalized =
    normalizeMerchant(merchant) || merchant.toUpperCase().replace(/\s+/g, " ").trim();
  return `${date}|${amountCents}|${normalized}`;
}

export function importCsv(state: AppState, csvText: string, nowISO: string, createdAt: string): CsvImportResult {
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    return emptyResult(["CSV has no data rows."]);
  }

  const headerRowIndex = findHeaderRowIndex(rows);
  if (headerRowIndex < 0) {
    return emptyResult([
      "Could not find Date, Amount, and Merchant/Description columns. Export from Wallet or your bank as CSV.",
    ]);
  }

  const headers = rows[headerRowIndex];
  const dateIdx = headerIndex(headers, DATE_HEADERS);
  const merchantIdx = headerIndex(headers, MERCHANT_HEADERS);
  const descIdx = headerIndex(headers, DESC_HEADERS);
  const amountIdx = headerIndex(headers, AMOUNT_HEADERS);
  const debitIdx = headerIndex(headers, ["debit"]);
  const creditIdx = headerIndex(headers, ["credit"]);
  const typeIdx = headerIndex(headers, ["type", "transaction type"]);
  const categoryIdx = headerIndex(headers, ["category"]);
  const balanceIdx = headerIndex(headers, BALANCE_HEADERS);

  if (dateIdx < 0 || merchantIdx < 0 || (amountIdx < 0 && debitIdx < 0 && creditIdx < 0)) {
    return emptyResult([
      "Could not find Date, Amount, and Merchant/Description columns. Export from Wallet or your bank as CSV.",
    ]);
  }

  const dataRows = rows.slice(headerRowIndex + 1);
  const convention = detectAmountConvention(
    headers,
    typeIdx,
    debitIdx,
    creditIdx,
    balanceIdx,
    dataRows,
    amountIdx,
    merchantIdx,
    descIdx
  );

  const preambleBalance = parsePreambleBalance(rows, headerRowIndex);
  let lastColumnBalance: number | undefined;
  const existing = new Set(
    state.expenses.map((e) => importFingerprint(e.date, e.amountCents, e.merchant))
  );
  const added: Expense[] = [];
  let skipped = 0;
  let duplicates = 0;
  const errors: string[] = [];

  for (const row of dataRows) {
    if (balanceIdx >= 0) {
      const rawBal = row[balanceIdx] ?? "";
      if (looksLikeMoney(rawBal)) lastColumnBalance = parseMoneyCell(rawBal);
    }

    const type = typeIdx >= 0 ? (row[typeIdx] ?? "").toLowerCase() : "";
    const desc = (row[descIdx >= 0 ? descIdx : merchantIdx] ?? "").trim();
    const merchant = (row[merchantIdx] ?? desc).trim() || "Unknown";
    if (isPaymentOrCredit(type, desc, merchant)) {
      skipped += 1;
      continue;
    }

    const parsedDate = parseDateCell(row[dateIdx] ?? "");
    if (!parsedDate) {
      skipped += 1;
      continue;
    }

    const signedCents = parseSignedAmountCents(row, amountIdx, debitIdx, creditIdx);
    if (convention === "debit-negative" && signedCents >= 0) {
      skipped += 1;
      continue;
    }
    if (convention === "charge-positive" && signedCents <= 0) {
      skipped += 1;
      continue;
    }

    const amountCents = Math.abs(signedCents);
    if (amountCents <= 0) {
      skipped += 1;
      continue;
    }

    const date = parsedDate > nowISO ? nowISO : parsedDate;
    const fp = importFingerprint(date, amountCents, merchant);
    if (existing.has(fp)) {
      duplicates += 1;
      continue;
    }

    const importedCat = categoryIdx >= 0 ? mapImportedCategory(row[categoryIdx] ?? "") : null;
    const suggested = suggestCategory(merchant, state.merchantRules);
    const categoryId: CategoryId =
      importedCat ?? (suggested.source === "fallback" ? UNCATEGORIZED_CATEGORY_ID : suggested.categoryId);

    const expense: Expense = {
      id: nanoid(),
      amountCents,
      merchant,
      note: desc && desc !== merchant ? desc : "",
      categoryId,
      date,
      source: "csv",
      createdAt,
      autoCategorized: !importedCat && suggested.source !== "rule",
    };
    added.push(expense);
    existing.add(fp);
  }

  if (added.length === 0 && duplicates === 0 && skipped === 0) {
    errors.push("No purchases found in that file.");
  }

  const suggestedCheckingCents =
    lastColumnBalance !== undefined
      ? lastColumnBalance
      : preambleBalance !== undefined
        ? preambleBalance
        : undefined;

  return { added, skipped, duplicates, errors, suggestedCheckingCents };
}
