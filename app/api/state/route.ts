import { NextResponse } from "next/server";
import { bootstrap } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await bootstrap();
  return NextResponse.json(data);
}
