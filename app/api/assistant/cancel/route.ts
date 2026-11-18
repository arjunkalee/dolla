import { cookies } from "next/headers";
import { sessionCookieName } from "@/lib/auth";
import { handleCancelRequest } from "@/lib/assistant/apply-edit";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value;
  let proposalId: unknown;
  try {
    const body = (await request.json()) as { proposalId?: unknown };
    proposalId = body?.proposalId;
  } catch {
    return Response.json({ error: "Missing confirm card.", code: "bad_request" }, { status: 400 });
  }
  return handleCancelRequest({ sessionToken: token, proposalId });
}
