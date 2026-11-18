"use client";

import { Button } from "@/components/ui/button";
import type { ChatProposal, ProposalChange } from "@/lib/types";

const HIDDEN_FIELDS = new Set(["paidExpenseId", "createdAt", "autoCategorized", "source", "exists"]);

const STALE_COPY = "That value changed since this was proposed. Ask again and I'll make a fresh card.";

function visibleChanges(proposal: ChatProposal): ProposalChange[] {
  return proposal.changes.filter(
    (change) => !HIDDEN_FIELDS.has(change.field) && change.oldLabel !== change.newLabel
  );
}

export function ProposalCard({
  proposal,
  ready,
  busy,
  notice,
  onConfirm,
  onCancel,
  onUndo,
}: {
  proposal: ChatProposal;
  ready: boolean;
  busy: boolean;
  notice?: string | null;
  onConfirm: (proposalId: string) => void;
  onCancel: (proposalId: string) => void;
  onUndo: (proposalId: string, auditId: string) => void;
}) {
  const rows = visibleChanges(proposal);
  return (
    <section
      data-testid="proposal-card"
      data-proposal-status={proposal.status}
      className="mr-4 rounded-2xl bg-card px-4 py-3 text-sm ring-1 ring-foreground/15"
      aria-label={proposal.summary}
    >
      <p className="font-medium leading-snug">{proposal.summary}</p>
      {rows.length > 0 && (
        <dl className="mt-2 space-y-1.5">
          {rows.map((change) => (
            <div key={`${change.entity}:${change.field}`} className="grid grid-cols-[5.5rem_1fr] gap-2 text-xs">
              <dt className="text-muted-foreground">{change.fieldLabel}</dt>
              <dd>
                <span className="text-muted-foreground">{change.oldLabel}</span>
                <span className="px-1 text-muted-foreground">→</span>
                <span>{change.newLabel}</span>
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {proposal.status === "pending" && ready && (
          <>
            <Button
              type="button"
              data-testid="proposal-confirm"
              disabled={busy}
              onClick={() => onConfirm(proposal.id)}
            >
              Confirm
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="proposal-cancel"
              disabled={busy}
              onClick={() => onCancel(proposal.id)}
            >
              Cancel
            </Button>
          </>
        )}
        {proposal.status === "pending" && !ready && (
          <p className="text-xs text-muted-foreground">Saving this card…</p>
        )}
        {proposal.status === "applied" && proposal.auditId && (
          <Button
            type="button"
            variant="outline"
            data-testid="proposal-undo"
            disabled={busy}
            onClick={() => onUndo(proposal.id, proposal.auditId!)}
          >
            Undo
          </Button>
        )}
      </div>
      {proposal.status === "applied" && <p className="mt-2 text-xs text-muted-foreground">Saved.</p>}
      {proposal.status === "cancelled" && (
        <p className="mt-2 text-xs text-muted-foreground">Cancelled. Nothing changed.</p>
      )}
      {proposal.status === "undone" && (
        <p className="mt-2 text-xs text-muted-foreground">Undone. The previous value is back.</p>
      )}
      {proposal.status === "stale" && <p className="mt-2 text-xs text-destructive">{STALE_COPY}</p>}
      {notice && proposal.status !== "stale" && <p className="mt-2 text-xs text-destructive">{notice}</p>}
    </section>
  );
}
