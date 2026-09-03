import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { sessionCookieName, sessionValid } from "./lib/auth";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/api/auth/login") || pathname.startsWith("/api/auth/status")) {
    return NextResponse.next();
  }
  const token = request.cookies.get(sessionCookieName())?.value;
  const ok = await sessionValid(token);

  if (pathname === "/login") {
    if (ok) {
      return NextResponse.redirect(new URL("/", request.url));
    }
    return NextResponse.next();
  }

  if (!ok) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Locked" }, { status: 401 });
    }
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon|manifest.webmanifest|sw.js|icons/|sample/).*)",
  ],
};
