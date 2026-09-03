import { NextResponse } from "next/server";
import { importStatement } from "@/lib/actions";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  let csvText = "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (file instanceof File) {
      csvText = await file.text();
    }
  } else {
    const body = await request.json().catch(() => null);
    csvText = String(body?.csv ?? "");
  }
  if (!csvText.trim()) {
    return NextResponse.json({ error: "Choose a CSV file." }, { status: 400 });
  }
  const data = await importStatement(csvText);
  return NextResponse.json(data);
}
