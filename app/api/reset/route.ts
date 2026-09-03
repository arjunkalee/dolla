import { NextResponse } from "next/server";
import { resetData } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const mode = body.mode === "empty" || body.mode === "keep-settings" ? body.mode : "sample";
  const data = await resetData(mode);
  return NextResponse.json(data);
}
