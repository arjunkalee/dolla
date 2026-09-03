import { NextResponse } from "next/server";
import { confirmSetAsides, saveSavingsTargets } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const body = await request.json();
  const data = await saveSavingsTargets(body.savings);
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const body = await request.json();
  const data = await confirmSetAsides({
    date: body.date,
    amounts: body.amounts ?? {},
  });
  return NextResponse.json(data);
}
