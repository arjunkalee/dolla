---
name: add-assistant-tool
description: Use when adding a new tool the Dolla in-app Claude assistant can call.
---

# Add an assistant tool

Use this when the in-app Claude assistant needs a new action: a read of the ledger, or a proposed edit that waits for a confirm card.

The assistant only knows what a tool returns. Live dollar amounts belong in the tool result, never in the tool definition or the system prompt. Those two are cached.

## Steps

1. **Define the tool.** For a read, add it in `lib/assistant/tools.ts`. For an edit, add it in `lib/assistant/proposals.ts`. Give it a `name`, a `description` that says when to call it, and an `input_schema` of `{ type: "object", properties, additionalProperties: false }`. A tool with no inputs uses an empty `properties` object. Add the name to `READ_TOOL_NAMES` or `EDIT_TOOL_NAMES` in the same order as the definition list.

2. **Dispatch it and return a tool result.** Handle the name in `executeReadTool` (`lib/assistant/tools.ts`) or `executeEditTool` (`lib/assistant/proposals.ts`). Return `{ ok: true, data }` on success or `{ ok: false, error }` on bad input. `lib/assistant/loop.ts` turns that into a `tool_result`. On failure it sets `is_error` and keeps the turn going, so do not throw for a normal validation miss. Do not import `lib/store` from a tool file, and do not call `saveState`, `updateState`, or `fetch`. Reuse helpers that already compute the figure (`computeInsights` in `lib/plan.ts`, `budgetBreakdown` in `lib/budget-share.ts`, `formatCents` in `lib/money.ts`) instead of writing the math again.

3. **Keep the cache breakpoint on the last client tool.** `cachedAssistantTools()` in `lib/assistant/tools.ts` stamps `cache_control` on the last tool only. Put the new tool before that last tool so the stamp does not move. `withMemoryTools` in `lib/assistant/memory.ts` inserts `remember_fact` and `forget_fact` in front of the last tool. `toolsForApiCall` in `lib/assistant/web-search.ts` appends `web_search` after the client tools and does not take the breakpoint. Do not set `cache_control` on the new tool yourself.

4. **Tell the model when to call it.** Add a short line to `ASSISTANT_SYSTEM_PROMPT` in `lib/assistant/prompt.ts`. Say what the tool is for. For a broad question, point at `get_app_overview` before a narrower read. Do not put balances, bill amounts, or other live dollars in the prompt or the tool description.

5. **Writes use propose_* plus a confirm card.** Anything that changes the ledger is a `propose_*` tool. It returns a proposal and does not save. `lib/assistant/loop.ts` emits the proposal, and the chat shows the confirm card. Confirm and undo already run in `lib/assistant/apply-edit.ts` (`handleApplyRequest`, `handleUndoRequest`). The card must carry the old value so confirm can refuse the edit if the ledger changed. Do not add a tool that writes on its own.

6. **Add an eval.** In `scripts/verify-assistant-evals.ts`, add a case whose prompt should call the tool, with the input the model would send. The eval mocks the model, checks the tool ran, and checks the answer only cites figures that were in the tool result. For a read, also assert the payload in `scripts/verify-assistant-tools.ts`. Leave the checking balance out of a broad snapshot (it is hidden on purpose), and never return a PIN, a session token, or an API key.

7. **Check and open the PR.** Run `npm run build`, `npm run lint`, and `npm run test:assistant` (the evals run offline with a fake key). Branch from main as `dolla/DOLLA-n-slug`. Put the ticket id in the PR title and in every commit message. Open the PR against main and do not merge it.

## How the tool loop works

Someone types in Chat. `lib/assistant/handle.ts` loads the ledger, marks past-due bills paid, and asks the model to answer. The model sees the standing prompt, the tool list, and the conversation. It does not get a private copy of the database.

If it needs a number, it names a tool and the arguments. `lib/assistant/loop.ts` runs that tool on the ledger already in memory and sends the JSON back as a tool result. A bad call comes back marked as an error, and the model is supposed to say it does not have the figure instead of inventing one. It can call another tool or write the reply. That round trip stops after six tries.

A `propose_*` tool is different from a read. It does not change anything. It describes the change, the loop hands that description to the screen, and the person sees a card with confirm and cancel. Only the confirm path in `lib/assistant/apply-edit.ts` writes the ledger, and it stores an audit entry so the same person can undo it.
