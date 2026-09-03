import { NextResponse } from "next/server";
import { saveBudget } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const body = await request.json();
  const data = await saveBudget(body.categories);
  return NextResponse.json(data);
}
