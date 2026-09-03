import { NextResponse } from "next/server";
import { logPurchase } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const data = await logPurchase({
      amountCents: Number(body.amountCents),
      merchant: String(body.merchant ?? ""),
      note: body.note ? String(body.note) : "",
      categoryId: body.categoryId,
      date: body.date ? String(body.date) : undefined,
    });
    return NextResponse.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not log purchase.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
