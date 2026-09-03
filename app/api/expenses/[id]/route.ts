import { NextResponse } from "next/server";
import { deleteExpense, recategorizeExpense } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = await request.json();
  const data = await recategorizeExpense(id, body.categoryId);
  return NextResponse.json(data);
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const data = await deleteExpense(id);
  return NextResponse.json(data);
}
