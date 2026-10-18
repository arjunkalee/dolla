"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { parseChat } from "@/lib/chat";
import type { ChatProposal } from "@/lib/types";
import { useDolla } from "./dolla-provider";
import { ProposalCard } from "./proposal-card";

type Spend = {
  monthSpendUsd: number;
  capUsd: number;
};

type Draft = {
  user: string;
  reply: string;
  done: boolean;
  proposals: ChatProposal[];
};

export function ChatScreen() {
  const { state, sendChat, refresh } = useDolla();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [lookingUp, setLookingUp] = useState(false);
  const [spend, setSpend] = useState<Spend | null>(null);
  const [cardNotice, setCardNotice] = useState<{ id: string; message: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const proposalCount = state?.chatMessages.reduce((sum, message) => sum + (message.proposals?.length ?? 0), 0) ?? 0;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state?.chatMessages.length, proposalCount, draft?.reply, draft?.proposals.length, busy]);

  useEffect(() => {
    let cancel = false;
    fetch("/api/assistant", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Spend | null) => {
        if (!cancel && data && typeof data.monthSpendUsd === "number" && typeof data.capUsd === "number") {
          setSpend(data);
        }
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [state?.chatMessages.length]);

  if (!state) return null;

  const previous = state.chatMessages[state.chatMessages.length - 2];
  const latest = state.chatMessages[state.chatMessages.length - 1];
  const storedReply = Boolean(
    draft?.done &&
      latest?.role === "dolla" &&
      latest.text === draft.reply &&
      previous?.role === "user" &&
      previous.text === draft.user
  );

  async function submit() {
    const value = text.trim();
    if (!value || busy || !state) return;
    setBusy(true);
    setError(null);
    setLookingUp(false);
    setText("");
    try {
      const intent = parseChat(value, state);
      if (intent.type !== "unknown") {
        setDraft(null);
        await sendChat(value);
        return;
      }
      await askAssistant(value);
    } catch (err) {
      setDraft(null);
      setError(err instanceof Error ? err.message : "Could not send.");
      setText(value);
    } finally {
      setBusy(false);
    }
  }

  async function postCard(path: string, body: Record<string, unknown>, noticeId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setCardNotice({ id: noticeId, message: data?.error || "Could not update that." });
      } else {
        setCardNotice(null);
      }
      await refresh();
    } catch (err) {
      setCardNotice({
        id: noticeId,
        message: err instanceof Error ? err.message : "Could not update that.",
      });
    } finally {
      setBusy(false);
    }
  }

  function confirmProposal(proposalId: string) {
    return postCard("/api/assistant/apply", { proposalId }, proposalId);
  }

  function cancelProposal(proposalId: string) {
    return postCard("/api/assistant/cancel", { proposalId }, proposalId);
  }

  function undoProposal(proposalId: string, auditId: string) {
    return postCard("/api/assistant/undo", { auditId }, proposalId);
  }

  function undoLatest() {
    const latest = state?.assistantAudit?.[state.assistantAudit.length - 1];
    return postCard("/api/assistant/undo", {}, latest?.id ?? "latest");
  }

  async function askAssistant(value: string) {
    setLookingUp(false);
    setCardNotice(null);
    setDraft({ user: value, reply: "", done: false, proposals: [] });
    const res = await fetch("/api/assistant", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: value }),
    });
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      const data = (await res.json().catch(() => null)) as {
        error?: string;
        message?: string;
        code?: string;
        monthSpendUsd?: number;
        capUsd?: number;
      } | null;
      if (data?.code === "cap" && data.message) {
        if (typeof data.monthSpendUsd === "number" && typeof data.capUsd === "number") {
          setSpend({ monthSpendUsd: data.monthSpendUsd, capUsd: data.capUsd });
        }
        setDraft({ user: value, reply: data.message, done: true, proposals: [] });
        await refresh();
        return;
      }
      throw new Error(data?.error || "The assistant could not answer.");
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("The assistant could not answer.");
    const decoder = new TextDecoder();
    let buffer = "";
    let reply = "";
    const proposals: ChatProposal[] = [];
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.split("\n").find((entry) => entry.startsWith("data:"));
        if (!line) continue;
        const event = JSON.parse(line.slice(5).trim()) as {
          type?: string;
          text?: string;
          message?: string;
          status?: string;
          monthSpendUsd?: number;
          capUsd?: number;
          proposal?: ChatProposal;
        };
        if (event.type === "reset") {
          reply = "";
          proposals.length = 0;
          setLookingUp(true);
          setDraft({ user: value, reply: "", done: false, proposals: [] });
        } else if (event.type === "proposal" && event.proposal?.id) {
          if (!proposals.some((proposal) => proposal.id === event.proposal?.id)) {
            proposals.push(event.proposal);
          }
          setLookingUp(false);
          setDraft({ user: value, reply, done: false, proposals: [...proposals] });
        } else if (event.type === "status" && event.status === "looking_up") {
          setLookingUp(true);
        } else if (event.type === "delta" && event.text) {
          setLookingUp(false);
          reply += event.text;
          setDraft({ user: value, reply, done: false, proposals: [...proposals] });
        } else if (event.type === "done") {
          setLookingUp(false);
          if (typeof event.monthSpendUsd === "number" && typeof event.capUsd === "number") {
            setSpend({ monthSpendUsd: event.monthSpendUsd, capUsd: event.capUsd });
          }
        } else if (event.type === "error") {
          if (reply.trim()) {
            setDraft({ user: value, reply: reply.trim(), done: true, proposals: [...proposals] });
            setError(event.message || "The assistant could not answer.");
            return;
          }
          throw new Error(event.message || "The assistant could not answer.");
        }
      }
    }
    const finalReply = reply.trim() || "I don't have a reply for that.";
    setDraft({ user: value, reply: finalReply, done: true, proposals: [...proposals] });
    await refresh();
  }

  const latestAudit = state.assistantAudit?.[state.assistantAudit.length - 1];

  return (
    <div className="flex min-h-[calc(100dvh-8.5rem)] flex-col">
      <header className="mb-3">
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Chat</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask about the budget, or edit with a command like “log $10 dining”. Assistant edits wait for a confirm card.
        </p>
      </header>

      {latestAudit && !latestAudit.undoneAt && (
        <button
          type="button"
          className="mb-3 text-left text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-50"
          disabled={busy}
          data-testid="undo-latest"
          onClick={() => void undoLatest()}
        >
          Undo last assistant edit
          {latestAudit.summary ? `: ${latestAudit.summary}` : ""}
        </button>
      )}

      <div className="flex-1 space-y-3" aria-live="polite">
        {state.chatMessages.length === 0 && !draft && (
          <div className="rounded-2xl bg-card px-4 py-4 text-sm text-muted-foreground ring-1 ring-foreground/10">
            <p>Examples:</p>
            <p className="mt-2 font-mono text-xs text-foreground">log $10 dining</p>
            <p className="font-mono text-xs text-foreground">change groceries to 300</p>
            <p className="font-mono text-xs text-foreground">how much is left for dining?</p>
            <p className="font-mono text-xs text-foreground">Apple Card is paid</p>
          </div>
        )}
        {state.chatMessages.map((message) => (
          <div key={message.id} className="space-y-2">
            <Bubble role={message.role} text={message.text} />
            {message.proposals?.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                ready
                busy={busy}
                notice={cardNotice?.id === proposal.id ? cardNotice.message : null}
                onConfirm={(id) => void confirmProposal(id)}
                onCancel={(id) => void cancelProposal(id)}
                onUndo={(id, auditId) => void undoProposal(id, auditId)}
              />
            ))}
          </div>
        ))}
        {draft && !storedReply && (
          <>
            <Bubble role="user" text={draft.user} />
            {(draft.reply || busy) && (
              <Bubble
                role="dolla"
                text={draft.reply || (lookingUp ? "looking up…" : "…")}
                pending={!draft.reply}
              />
            )}
            {draft.proposals.map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                ready={false}
                busy={busy}
                notice={null}
                onConfirm={(id) => void confirmProposal(id)}
                onCancel={(id) => void cancelProposal(id)}
                onUndo={(id, auditId) => void undoProposal(id, auditId)}
              />
            ))}
          </>
        )}
        <div ref={endRef} />
      </div>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      <form
        className="mt-auto bg-background pb-2 pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="flex gap-2">
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Ask, or log $10 dining"
            className="h-12 min-w-0 flex-1 rounded-xl border border-input bg-card px-3 text-base"
            autoComplete="off"
            autoCorrect="off"
            enterKeyHint="send"
          />
          <Button type="submit" className="h-12 w-12" disabled={busy} aria-label="Send">
            {busy ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />}
          </Button>
        </div>
        <p className="pt-2 text-center text-xs text-muted-foreground">
          Assistant this month {spend ? formatAiUsd(spend.monthSpendUsd) : "—"} of{" "}
          {spend ? formatAiUsd(spend.capUsd) : "$10"}
        </p>
      </form>
    </div>
  );
}

function Bubble({
  role,
  text,
  pending = false,
}: {
  role: "user" | "dolla";
  text: string;
  pending?: boolean;
}) {
  return (
    <article
      className={
        role === "user"
          ? "ml-8 rounded-2xl bg-primary px-4 py-3 text-sm text-primary-foreground"
          : "mr-4 whitespace-pre-wrap rounded-2xl bg-card px-4 py-3 text-sm leading-relaxed ring-1 ring-foreground/10"
      }
    >
      <span className={pending ? "text-muted-foreground" : undefined}>{text}</span>
    </article>
  );
}

function formatAiUsd(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: value > 0 && value < 0.01 ? 4 : 2,
  }).format(value);
}
