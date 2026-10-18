"use client";

import { SUGGESTED_PROMPTS } from "@/lib/assistant/suggestions";

export function SuggestedPrompts({
  disabled,
  onPick,
}: {
  disabled?: boolean;
  onPick: (text: string) => void;
}) {
  return (
    <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Suggested prompts">
      {SUGGESTED_PROMPTS.map((prompt) => (
        <button
          key={prompt.text}
          type="button"
          disabled={disabled}
          onClick={() => onPick(prompt.text)}
          className="shrink-0 rounded-full bg-card px-3 py-2 text-sm ring-1 ring-foreground/10 disabled:opacity-50"
        >
          {prompt.label}
        </button>
      ))}
    </div>
  );
}
