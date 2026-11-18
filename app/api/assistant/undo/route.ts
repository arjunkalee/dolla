import { cookies } from "next/headers";
import { sessionCookieName } from "@/lib/auth";
import { handleUndoRequest } from "@/lib/assistant/apply-edit";

export const dynamic = "force-dynamic";

/** Undo one applied assistant edit. Omit auditId to undo the most recent one. */
export async function POST(request: Request) {
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value;
  let auditId: unknown;
  try {
    const body = (await request.json()) as { auditId?: unknown };
    auditId = body?.auditId;
  } catch {
    auditId = undefined;
  }
  return handleUndoRequest({ sessionToken: token, auditId });
}
