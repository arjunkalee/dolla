import { NextResponse } from "next/server";
import { parseResetMode, resetData } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode = parseResetMode(body.mode);
    const data = await resetData(mode);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reset the ledger.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
