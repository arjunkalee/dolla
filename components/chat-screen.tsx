"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDolla } from "./dolla-provider";

export function ChatScreen() {
  const { state, sendChat } = useDolla();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state?.chatMessages.length]);

  if (!state) return null;

  async function submit() {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    setText("");
    try {
      await sendChat(value);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send.");
      setText(value);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100dvh-8.5rem)] flex-col">
      <header className="mb-3">
        <h1 className="text-[1.75rem] font-semibold tracking-tight">Chat</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          “$10 for restaurant” logs spend. “restaurant envelope is 400” changes the monthly envelope.
          I do not invent transactions.
        </p>
      </header>

      <div className="flex-1 space-y-3">
        {state.chatMessages.length === 0 && (
          <div className="rounded-2xl bg-card px-4 py-4 text-sm text-muted-foreground ring-1 ring-foreground/10">
            <p>Examples:</p>
            <p className="mt-2 font-mono text-xs text-foreground">$10 for restaurant</p>
            <p className="font-mono text-xs text-foreground">change groceries to 300</p>
            <p className="font-mono text-xs text-foreground">restaurant envelope is 400</p>
            <p className="font-mono text-xs text-foreground">Apple Card is paid</p>
            <p className="font-mono text-xs text-foreground">paycheck is 2771.55</p>
          </div>
        )}
        {state.chatMessages.map((m) => (
          <article
            key={m.id}
            className={
              m.role === "user"
                ? "ml-8 rounded-2xl bg-primary px-4 py-3 text-sm text-primary-foreground"
                : "mr-4 whitespace-pre-wrap rounded-2xl bg-card px-4 py-3 font-mono text-xs ring-1 ring-foreground/10"
            }
          >
            {m.text}
          </article>
        ))}
        <div ref={endRef} />
      </div>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      <form
        className="mt-auto flex gap-2 bg-background pb-2 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="checking is 5100"
          className="h-12 min-w-0 flex-1 rounded-xl border border-input bg-card px-3 text-base"
          autoComplete="off"
          enterKeyHint="send"
        />
        <Button type="submit" className="h-12 w-12" disabled={busy} aria-label="Send">
          {busy ? <Loader2 className="size-5 animate-spin" /> : <Send className="size-5" />}
        </Button>
      </form>
    </div>
  );
}
