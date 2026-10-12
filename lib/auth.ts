import { SignJWT, jwtVerify } from "jose";

const COOKIE = "dolla_session";

/**
 * Built-in unlock PIN, stored as salted SHA-256 of `${salt}:${pin}`.
 * `DOLLA_PIN`, when set, replaces this hash and is compared on the server.
 */
const DEFAULT_PIN_SALT = "d1ce78796b15433611509f47a79bb294";
const DEFAULT_PIN_SHA256 = "ed9ee901387f416dccd02ad5eea372a7e6700ee5f1c50e0fc3cacf45fc4f6e67";
const DEFAULT_PIN_HINT = { length: 4, numeric: true } as const;

function pinOverride(): string | null {
  const value = process.env.DOLLA_PIN?.trim();
  return value ? value : null;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

async function secretKey(): Promise<Uint8Array> {
  // Same fallback as before DOLLA-16 so existing session cookies stay valid.
  const raw = process.env.DOLLA_SESSION_SECRET?.trim() || "dolla-dev-4826-not-for-prod";
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return new Uint8Array(digest);
}

export function authConfigured(): boolean {
  return pinOverride() !== null || DEFAULT_PIN_SHA256.length > 0;
}

export function pinHint(): { length: number; numeric: boolean } | null {
  const override = pinOverride();
  if (!override) return DEFAULT_PIN_HINT;
  return {
    length: override.length,
    numeric: /^\d+$/.test(override),
  };
}

export async function verifyPin(candidate: string): Promise<boolean> {
  const override = pinOverride();
  if (override) {
    const encoder = new TextEncoder();
    return timingSafeEqual(encoder.encode(candidate), encoder.encode(override));
  }
  const digest = await sha256(`${DEFAULT_PIN_SALT}:${candidate}`);
  return timingSafeEqual(digest, hexToBytes(DEFAULT_PIN_SHA256));
}

export async function createSessionToken(): Promise<string> {
  return new SignJWT({ app: "dolla" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(await secretKey());
}

export async function sessionValid(token: string | undefined | null): Promise<boolean> {
  if (!token) return false;
  try {
    await jwtVerify(token, await secretKey());
    return true;
  } catch {
    return false;
  }
}

export function sessionCookieName(): string {
  return COOKIE;
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.VERCEL === "1" || process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}
