import { cookies } from "next/headers";
import { sessionCookieName, sessionValid } from "@/lib/auth";
import { streamAssistant } from "@/lib/assistant/anthropic";
import { handleAssistantRequest } from "@/lib/assistant/handle";
import { readMonthSpend } from "@/lib/assistant/usage";

export const dynamic = "force-dynamic";
/** A few tool rounds can run longer than a single completion. */
export const maxDuration = 120;

async function sessionToken(): Promise<string | undefined> {
  const jar = await cookies();
  return jar.get(sessionCookieName())?.value;
}

export async function GET() {
  const token = await sessionToken();
  if (!(await sessionValid(token))) {
    return Response.json({ error: "Locked" }, { status: 401 });
  }
  const spend = await readMonthSpend();
  return Response.json({
    monthKey: spend.monthKey,
    monthSpendUsd: spend.monthSpendUsd,
    capUsd: spend.capUsd,
    requests: spend.requests,
    resetOn: spend.resetOn,
  });
}

export async function POST(request: Request) {
  const token = await sessionToken();
  let text = "";
  try {
    const body = (await request.json()) as { text?: unknown };
    text = typeof body?.text === "string" ? body.text : "";
  } catch {
    return Response.json({ error: "Send a message.", code: "bad_request" }, { status: 400 });
  }
  return handleAssistantRequest({
    sessionToken: token,
    text,
    signal: request.signal,
    streamReply: streamAssistant,
  });
}
