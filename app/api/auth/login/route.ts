import { NextResponse } from "next/server";
import {
  authConfigured,
  createSessionToken,
  pinHint,
  sessionCookieName,
  sessionCookieOptions,
  verifyPin,
} from "@/lib/auth";

export async function GET() {
  return NextResponse.json({
    configured: authConfigured(),
    hint: pinHint(),
  });
}

export async function POST(request: Request) {
  if (!authConfigured()) {
    return NextResponse.json(
      { error: "Set DOLLA_PIN on the server before unlocking." },
      { status: 503 }
    );
  }
  const body = (await request.json().catch(() => null)) as { pin?: string } | null;
  const candidate = body?.pin?.trim() ?? "";
  if (!verifyPin(candidate)) {
    return NextResponse.json({ error: "Wrong PIN." }, { status: 401 });
  }
  const token = await createSessionToken();
  const response = NextResponse.json({ ok: true });
  response.cookies.set(sessionCookieName(), token, sessionCookieOptions());
  return response;
}
