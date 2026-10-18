import type { ChatCitation } from "@/lib/types";

/**
 * Bare hosts the web_search tool may cite. No scheme. Subdomains are included.
 * Edit this list to change which finance and news sites the assistant can use.
 */
export const WEB_SEARCH_ALLOWED_DOMAINS = [
  "federalreserve.gov",
  "fdic.gov",
  "consumerfinance.gov",
  "treasury.gov",
  "bls.gov",
  "bea.gov",
  "sec.gov",
  "investor.gov",
  "fred.stlouisfed.org",
  "bankrate.com",
  "nerdwallet.com",
  "kiplinger.com",
  "morningstar.com",
  "wsj.com",
  "reuters.com",
  "bloomberg.com",
  "apnews.com",
  "cnbc.com",
  "ft.com",
  "nytimes.com",
  "finance.yahoo.com",
] as const;

/** Anthropic applies this per Messages API request, including a paused continuation. */
export const WEB_SEARCH_MAX_USES = 3;

export const WEB_SEARCH_TOOL_TYPE = "web_search_20250305" as const;

export const WEB_SEARCH_UNAVAILABLE_MESSAGE =
  "Web search was unavailable, so I couldn't look that up.";

export type WebSearchToolParam = {
  type: typeof WEB_SEARCH_TOOL_TYPE;
  name: "web_search";
  max_uses: number;
  allowed_domains: string[];
  allowed_callers: ["direct"];
  user_location: {
    type: "approximate";
    country: "US";
    region: "Illinois";
    timezone: "America/Chicago";
  };
};

export function webSearchTool(): WebSearchToolParam {
  return {
    type: WEB_SEARCH_TOOL_TYPE,
    name: "web_search",
    max_uses: WEB_SEARCH_MAX_USES,
    allowed_domains: [...WEB_SEARCH_ALLOWED_DOMAINS],
    allowed_callers: ["direct"],
    user_location: {
      type: "approximate",
      country: "US",
      region: "Illinois",
      timezone: "America/Chicago",
    },
  };
}

/** Client read tools stay first so their cache breakpoint is unchanged. Web search is appended. */
export function toolsForApiCall<T>(clientTools: readonly T[]): Array<T | WebSearchToolParam> {
  return [...clientTools, webSearchTool()];
}

export type SearchRead = {
  citations: ChatCitation[];
  /** Every search in this payload failed, and there is nothing to cite. */
  failed: boolean;
};

/** Pull link data out of a Messages API content array. Ignores encrypted blobs. */
export function readSearchContent(content: unknown): SearchRead {
  if (!Array.isArray(content)) return { citations: [], failed: false };
  const citations: ChatCitation[] = [];
  const seen = new Set<string>();
  let errors = 0;
  let successes = 0;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const record = block as { type?: unknown; citations?: unknown; content?: unknown };
    if (record.type === "text" && Array.isArray(record.citations)) {
      for (const citation of record.citations) {
        const link = citationFromUnknown(citation);
        if (!link || seen.has(link.url)) continue;
        seen.add(link.url);
        citations.push(link);
      }
    }
    if (record.type !== "web_search_tool_result") continue;
    if (isSearchErrorContent(record.content)) errors += 1;
    else if (hasSuccessfulResult(record.content)) successes += 1;
  }
  return {
    citations,
    failed: errors > 0 && successes === 0 && citations.length === 0,
  };
}

/** Citation links the chat can render. Drops non-http URLs and encrypted fields. */
export function citationRenderingData(content: unknown): ChatCitation[] {
  return readSearchContent(content).citations;
}

export function sanitizeCitations(value: unknown): ChatCitation[] {
  if (!Array.isArray(value)) return [];
  const citations: ChatCitation[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const link = citationFromUnknown(item);
    if (!link || seen.has(link.url)) continue;
    seen.add(link.url);
    citations.push(link);
  }
  return citations;
}

export function searchFailureNote(reply: string): string {
  if (/web search was unavailable/i.test(reply)) return "";
  if (!reply.trim()) return WEB_SEARCH_UNAVAILABLE_MESSAGE;
  return `\n\n${WEB_SEARCH_UNAVAILABLE_MESSAGE}`;
}

/** True when the API rejected the request because web search itself failed. */
export function isWebSearchRequestError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /web[_\s-]*search/i.test(message);
}

function citationFromUnknown(value: unknown): ChatCitation | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { url?: unknown; title?: unknown; type?: unknown };
  if (typeof record.type === "string" && record.type !== "web_search_result_location") return null;
  const url = httpUrl(record.url);
  if (!url) return null;
  return { url, title: cleanTitle(record.title, url) };
}

function httpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 2_000) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  return url.toString();
}

function cleanTitle(title: unknown, url: string): string {
  const raw =
    typeof title === "string"
      ? title.replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim()
      : "";
  if (raw) return raw.slice(0, 140);
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Source";
  }
}

function isSearchErrorContent(content: unknown): boolean {
  if (!content || typeof content !== "object" || Array.isArray(content)) return false;
  return (content as { type?: unknown }).type === "web_search_tool_result_error";
}

function hasSuccessfulResult(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some((item) => {
    if (!item || typeof item !== "object") return false;
    const record = item as { type?: unknown; url?: unknown };
    return record.type === "web_search_result" && httpUrl(record.url) !== null;
  });
}
