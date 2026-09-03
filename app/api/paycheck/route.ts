import { NextResponse } from "next/server";
import { savePaycheck } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const body = await request.json();
  const data = await savePaycheck(body.paycheck);
  return NextResponse.json(data);
}
