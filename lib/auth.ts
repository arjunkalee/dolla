import { SignJWT, jwtVerify } from "jose";

const COOKIE = "dolla_session";

function pin(): string {
  const value = process.env.DOLLA_PIN?.trim();
  if (value) return value;
  return "4826";
}

async function secretKey(): Promise<Uint8Array> {
  const raw =
    process.env.DOLLA_SESSION_SECRET?.trim() ||
    `dolla-dev-${pin() ?? "local"}-not-for-prod`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return new Uint8Array(digest);
}

export function authConfigured(): boolean {
  return pin() !== null;
}

export function pinHint(): { length: number; numeric: boolean } | null {
  const value = pin();
  if (!value) return null;
  return {
    length: value.length,
    numeric: /^\d+$/.test(value),
  };
}

export function verifyPin(candidate: string): boolean {
  const expected = pin();
  if (!expected) return false;
  const encoder = new TextEncoder();
  const a = encoder.encode(candidate);
  const b = encoder.encode(expected);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
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
