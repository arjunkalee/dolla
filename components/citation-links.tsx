import type { ChatCitation } from "@/lib/types";
import { sanitizeCitations } from "@/lib/assistant/web-search";

export function CitationLinks({ citations }: { citations?: ChatCitation[] | null }) {
  const links = sanitizeCitations(citations);
  if (links.length === 0) return null;
  return (
    <div className="mt-2 border-t border-foreground/10 pt-2">
      <p className="text-[0.65rem] font-medium uppercase tracking-wide text-muted-foreground">Sources</p>
      <ul className="mt-1 space-y-0.5">
        {links.map((link) => (
          <li key={link.url}>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="break-words text-xs text-muted-foreground underline decoration-foreground/20 underline-offset-2"
            >
              {link.title}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
