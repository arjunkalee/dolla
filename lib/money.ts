export function dollarsToCents(value: string | number): number {
  if (typeof value === "number") {
    return Math.round(value * 100);
  }
  const cleaned = value.replace(/[^0-9.-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return 0;
  const n = Number.parseFloat(cleaned);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function formatCents(cents: number, options?: { sign?: boolean }): string {
  const abs = Math.abs(cents);
  const dollars = abs / 100;
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(dollars);
  if (options?.sign) {
    if (cents < 0) return `−${formatted}`;
    if (cents > 0) return `+${formatted}`;
  }
  if (cents < 0) return `−${formatted}`;
  return formatted;
}

export function formatWholeDollars(cents: number): string {
  const abs = Math.abs(Math.round(cents / 100));
  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(abs);
  return cents < 0 ? `−${formatted}` : formatted;
}

export function centsFromKeypad(rawDigits: string): number {
  const digits = rawDigits.replace(/\D/g, "").slice(0, 9);
  if (!digits) return 0;
  return Number.parseInt(digits, 10);
}

export function keypadDisplay(cents: number): string {
  return formatCents(cents);
}
