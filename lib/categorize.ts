import type { CategoryId } from "./types";

/** Catch-all envelope when a CSV row or merchant has no match. Same id as Misc — no new budget. */
export const UNCATEGORIZED_CATEGORY_ID: CategoryId = "misc";

const HEURISTICS: { pattern: RegExp; categoryId: CategoryId }[] = [
  { pattern: /UBER\s*EATS|DOORDASH|GRUBHUB|POSTMATES|TOAST\s*TAB|CAVIAR/, categoryId: "dining" },
  { pattern: /WHOLE\s*FOODS|WHOLEFDS|TRADER\s*JOE|JEWEL|KROGER|ALDI|H\s*E\s*B|HEB|COSTCO|SAMS\s*CLUB|SPROUTS|MARIANO|GROCERY|SUPERMARKET|FOOD\s*4\s*LESS|TONYS\s*FRESH|FRESH\s*MARKET|MEIJER|PUBLIX|SAFEWAY|WEGMANS/, categoryId: "groceries" },
  { pattern: /WALMART(?!\s*GAS)|TARGET(?!\s*COM)/, categoryId: "groceries" },
  { pattern: /SHELL|EXXON|CHEVRON|BP\b|MOBIL|SPEEDWAY|WAWA|GAS\s*STATION|CIRCLE\s*K|SUNOCO|MARATHON|VALERO|UNBRANDED/, categoryId: "gas" },
  { pattern: /\bUBER\b|\bLYFT\b|VENTRA|CTA\b|METRA|PARKING|I\s*PASS|IPASS|TOLL/, categoryId: "gas" },
  { pattern: /STARBUCKS|DUNKIN|CHIPOTLE|SWEETGREEN|MCDONALD|SHAKE\s*SHACK|PANERA|CAFE|COFFEE|TAQUERIA|PIZZA|SUSHI|RESTAURANT|BREWERY|WINE\s*BAR|\bBAR\b|BURGER|TACO|KITCHEN|BISTRO|PURPLE\s*PIG|PORTILLO|GIORDANO|LOU\s*MALNATI/, categoryId: "dining" },
  { pattern: /COMED|COM\s*ED|COMCAST|XFINITY|PEOPLES\s*GAS|NICOR|INTERNET|WATER\s*DEPT|CITY\s*OF\s*CHICAGO|WASTE\s*MGMT|GARBAGE/, categoryId: "utilities" },
  { pattern: /RENT|APARTMENT|PROPERTY|REALTY|LEASING|MANAGEMENT|HOA\b|LANDLORD/, categoryId: "rent" },
  { pattern: /AIRBNB|HOTEL|MARRIOTT|HILTON|HYATT|UNITED\s*AIR|SOUTHWEST|AMERICAN\s*AIR|DELTA|AIRLINE|AIRWAYS|JETBLUE|EXPEDIA|BOOKING\.COM/, categoryId: "travel" },
];

export function normalizeMerchant(name: string): string {
  return name
    .toUpperCase()
    .replace(/&AMP;/g, " AND ")
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\b(TST\*|TST|SQ\s*\*|SQ|PAYPAL|POS|DEBIT|ACH|ONLINE|STORE|PURCHASE|CARD)\b/g, " ")
    .replace(/\b\d{3,}\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function suggestCategory(
  merchant: string,
  rules: Record<string, CategoryId>
): { categoryId: CategoryId; source: "rule" | "heuristic" | "fallback" } {
  const key = normalizeMerchant(merchant);
  if (key && rules[key]) {
    return { categoryId: rules[key], source: "rule" };
  }
  if (merchant && rules[merchant.toUpperCase()]) {
    return { categoryId: rules[merchant.toUpperCase()], source: "rule" };
  }
  for (const { pattern, categoryId } of HEURISTICS) {
    if (pattern.test(key)) {
      return { categoryId, source: "heuristic" };
    }
  }
  return { categoryId: UNCATEGORIZED_CATEGORY_ID, source: "fallback" };
}

export function rememberMerchant(
  rules: Record<string, CategoryId>,
  merchant: string,
  categoryId: CategoryId
): Record<string, CategoryId> {
  const key = normalizeMerchant(merchant);
  if (!key) return rules;
  return { ...rules, [key]: categoryId };
}

export function expenseEnvelopeLabel(
  categories: { id: CategoryId; name: string }[],
  expense: { categoryId: CategoryId; autoCategorized: boolean }
): string {
  if (expense.autoCategorized && expense.categoryId === UNCATEGORIZED_CATEGORY_ID) {
    return "Uncategorized";
  }
  return categories.find((c) => c.id === expense.categoryId)?.name ?? "Uncategorized";
}

export function mapImportedCategory(label: string): CategoryId | null {
  const n = label.toLowerCase();
  if (/rent|housing/.test(n)) return "rent";
  if (/groc/.test(n)) return "groceries";
  if (/gas|transit|transport|uber|lyft|parking/.test(n)) return "gas";
  if (/restaurant|dining|food\s*and\s*drink|coffee/.test(n)) return "dining";
  if (/utilit|internet|electric/.test(n)) return "utilities";
  if (/travel|airline|hotel|lodging/.test(n)) return "travel";
  if (/weekend/.test(n)) return "weekends";
  if (/other|misc|uncategor/.test(n)) return UNCATEGORIZED_CATEGORY_ID;
  return null;
}
