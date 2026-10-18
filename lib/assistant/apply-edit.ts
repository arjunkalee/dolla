import { sessionValid } from "@/lib/auth";
import { updateState } from "@/lib/store";
import type { AppState } from "@/lib/types";
import {
  commitCancel,
  commitProposal,
  commitUndo,
  type CommitResult,
  type IdFactory,
} from "./proposals";

type UpdateLedger = (mutator: (state: AppState) => AppState) => Promise<AppState>;

function json(body: unknown, status: number): Response {
  return Response.json(body, { status });
}

function logSafe(error: unknown) {
  const raw = error instanceof Error ? error.message : "unknown";
  console.error("dolla.assistant.edit", raw.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[redacted]"));
}

async function gate(sessionToken: string | undefined | null): Promise<Response | null> {
  if (!(await sessionValid(sessionToken))) return json({ error: "Locked", code: "locked" }, 401);
  return null;
}

function finish(result: CommitResult | undefined): Response {
  if (!result) return json({ error: "Could not save that edit.", code: "unconfigured" }, 503);
  if (!result.ok) {
    const status = result.code === "missing" ? 404 : result.code === "stale" || result.code === "closed" ? 409 : 400;
    return json({ error: result.error, code: result.code }, status);
  }
  return json({ ok: true, auditId: result.auditId ?? null }, 200);
}

export async function handleApplyRequest(input: {
  sessionToken: string | undefined | null;
  proposalId: unknown;
  now?: Date;
  update?: UpdateLedger;
  ids?: IdFactory;
}): Promise<Response> {
  const locked = await gate(input.sessionToken);
  if (locked) return locked;
  if (typeof input.proposalId !== "string" || !input.proposalId.trim() || input.proposalId.length > 80) {
    return json({ error: "Missing confirm card.", code: "bad_request" }, 400);
  }
  const proposalId = input.proposalId.trim();
  const now = input.now ?? new Date();
  const update = input.update ?? updateState;
  let result: CommitResult | undefined;
  try {
    await update((state) => {
      result = commitProposal(state, proposalId, now, input.ids);
      return result.state;
    });
  } catch (error) {
    logSafe(error);
    return json({ error: "Could not save that edit.", code: "unconfigured" }, 503);
  }
  return finish(result);
}

export async function handleCancelRequest(input: {
  sessionToken: string | undefined | null;
  proposalId: unknown;
  update?: UpdateLedger;
}): Promise<Response> {
  const locked = await gate(input.sessionToken);
  if (locked) return locked;
  if (typeof input.proposalId !== "string" || !input.proposalId.trim() || input.proposalId.length > 80) {
    return json({ error: "Missing confirm card.", code: "bad_request" }, 400);
  }
  const proposalId = input.proposalId.trim();
  const update = input.update ?? updateState;
  let result: CommitResult | undefined;
  try {
    await update((state) => {
      result = commitCancel(state, proposalId);
      return result.state;
    });
  } catch (error) {
    logSafe(error);
    return json({ error: "Could not cancel that card.", code: "unconfigured" }, 503);
  }
  return finish(result);
}

export async function handleUndoRequest(input: {
  sessionToken: string | undefined | null;
  auditId?: unknown;
  now?: Date;
  update?: UpdateLedger;
}): Promise<Response> {
  const locked = await gate(input.sessionToken);
  if (locked) return locked;
  let auditId: string | undefined;
  if (input.auditId !== undefined && input.auditId !== null && input.auditId !== "") {
    if (typeof input.auditId !== "string" || input.auditId.length > 80) {
      return json({ error: "That edit cannot be undone.", code: "bad_request" }, 400);
    }
    auditId = input.auditId;
  }
  const now = input.now ?? new Date();
  const update = input.update ?? updateState;
  let result: CommitResult | undefined;
  try {
    await update((state) => {
      result = commitUndo(state, auditId, now);
      return result.state;
    });
  } catch (error) {
    logSafe(error);
    return json({ error: "Could not undo that edit.", code: "unconfigured" }, 503);
  }
  return finish(result);
}
