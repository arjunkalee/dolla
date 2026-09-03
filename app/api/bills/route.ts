import { NextResponse } from "next/server";
import { saveBills, setBillFromThisCheck, setBillPaid } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function PUT(request: Request) {
  const body = await request.json();
  const data = await saveBills(body.bills);
  return NextResponse.json(data);
}

export async function PATCH(request: Request) {
  const body = await request.json();
  if (typeof body.paid === "boolean" && body.id) {
    const data = await setBillPaid(String(body.id), body.paid);
    return NextResponse.json(data);
  }
  if (typeof body.fromThisCheck === "boolean" && body.id) {
    const data = await setBillFromThisCheck(String(body.id), body.fromThisCheck);
    return NextResponse.json(data);
  }
  return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
}
