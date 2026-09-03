import { NextResponse } from "next/server";
import { saveSplitAllocations } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const data = await saveSplitAllocations(body.allocations ?? []);
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save split.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
