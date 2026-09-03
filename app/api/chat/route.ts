import { NextResponse } from "next/server";
import { applyChatMessage } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const data = await applyChatMessage(String(body.text ?? ""));
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not apply that.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
