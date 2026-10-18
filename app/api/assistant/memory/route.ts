import { cookies } from "next/headers";
import { sessionCookieName, sessionValid } from "@/lib/auth";
import { clearMemorySummary, deleteMemoryFact, readAssistantMemory } from "@/lib/assistant/memory";

export const dynamic = "force-dynamic";

async function sessionToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(sessionCookieName())?.value;
}

function payload(memory: { facts: unknown; summary: string }) {
  return { facts: memory.facts, summary: memory.summary };
}

export async function GET() {
  if (!(await sessionValid(await sessionToken()))) {
    return Response.json({ error: "Locked" }, { status: 401 });
  }
  const memory = await readAssistantMemory();
  return Response.json(payload(memory));
}

export async function POST(request: Request) {
  if (!(await sessionValid(await sessionToken()))) {
    return Response.json({ error: "Locked" }, { status: 401 });
  }
  let body: { op?: unknown; id?: unknown };
  try {
    body = (await request.json()) as { op?: unknown; id?: unknown };
  } catch {
    return Response.json({ error: "Send a memory change." }, { status: 400 });
  }
  if (body.op === "delete" && typeof body.id === "string" && body.id.trim()) {
    const memory = await deleteMemoryFact(body.id.trim());
    return Response.json(payload(memory));
  }
  if (body.op === "clear-summary") {
    const memory = await clearMemorySummary();
    return Response.json(payload(memory));
  }
  return Response.json({ error: "Unknown memory change." }, { status: 400 });
}
