import { NextResponse } from "next/server";
import { saveChecking } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const body = await request.json();
  const data = await saveChecking(Number(body.checkingCents));
  return NextResponse.json(data);
}
