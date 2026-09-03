import { mapImportedCategory, suggestCategory } from "./categorize";
import { dollarsToCents } from "./money";
import { nanoid } from "nanoid";
import type { AppState, CategoryId, Expense } from "./types";

export type CsvImportResult = {
  added: Expense[];
  skipped: number;
  duplicates: number;
  errors: string[];
};

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
    const i = normalized.findIndex((h) => h === candidate || h.includes(candidate));
    if (i >= 0) return i;
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

function fingerprint(date: string, amountCents: number, merchant: string): string {
  return `${date}|${amountCents}|${merchant.toUpperCase().replace(/\s+/g, " ").trim()}`;
}

export function importCsv(state: AppState, csvText: string, nowISO: string, createdAt: string): CsvImportResult {
  const rows = parseCsv(csvText);
  if (rows.length < 2) {
    return { added: [], skipped: 0, duplicates: 0, errors: ["CSV has no data rows."] };
  }

  const headers = rows[0];
  const dateIdx = headerIndex(headers, [
    "transaction date",
    "trans date",
    "posted date",
    "clearing date",
    "date",
  ]);
  const merchantIdx = headerIndex(headers, ["merchant", "description", "name", "payee"]);
  const descIdx = headerIndex(headers, ["description", "memo", "note"]);
  const amountIdx = headerIndex(headers, ["amount (usd)", "amount", "debit", "charge"]);
  const typeIdx = headerIndex(headers, ["type", "transaction type"]);
  const categoryIdx = headerIndex(headers, ["category"]);

  if (dateIdx < 0 || amountIdx < 0 || merchantIdx < 0) {
    return {
      added: [],
      skipped: 0,
      duplicates: 0,
      errors: [
        "Could not find Date, Amount, and Merchant/Description columns. Export from Wallet or your bank as CSV.",
      ],
    };
  }

  const existing = new Set(
    state.expenses.map((e) => fingerprint(e.date, e.amountCents, e.merchant))
  );
  const added: Expense[] = [];
  let skipped = 0;
  let duplicates = 0;
  const errors: string[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const type = typeIdx >= 0 ? (row[typeIdx] ?? "").toLowerCase() : "";
    const desc = (row[descIdx >= 0 ? descIdx : merchantIdx] ?? "").trim();
    const merchant = (row[merchantIdx] ?? desc).trim() || "Unknown";
    if (/payment|thank you|apple card payment|autopay|credit card payment/i.test(`${type} ${desc} ${merchant}`)) {
      skipped += 1;
      continue;
    }
    if (type && /payment|credit|refund/.test(type) && !/purchase/.test(type)) {
      skipped += 1;
      continue;
    }

    const date = parseDateCell(row[dateIdx] ?? "");
    if (!date) {
      skipped += 1;
      continue;
    }
    const amountCents = Math.abs(dollarsToCents(row[amountIdx] ?? "0"));
    if (amountCents <= 0) {
      skipped += 1;
      continue;
    }

    const fp = fingerprint(date, amountCents, merchant);
    if (existing.has(fp)) {
      duplicates += 1;
      continue;
    }

    const importedCat = categoryIdx >= 0 ? mapImportedCategory(row[categoryIdx] ?? "") : null;
    const suggested = suggestCategory(merchant, state.merchantRules);
    const categoryId: CategoryId = importedCat ?? suggested.categoryId;

    const expense: Expense = {
      id: nanoid(),
      amountCents,
      merchant,
      note: desc && desc !== merchant ? desc : "",
      categoryId,
      date: date > nowISO ? nowISO : date,
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

  return { added, skipped, duplicates, errors };
}
