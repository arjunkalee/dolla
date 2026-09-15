# SCRUM-15 — Bank sync spike (Plaid vs CSV/email vs native)

**Ticket:** [SCRUM-15](https://arjunkale.atlassian.net/browse/SCRUM-15)  
**Parent:** [SCRUM-13](https://arjunkale.atlassian.net/browse/SCRUM-13) — Money freshness  
**App:** [dolla-now.vercel.app](https://dolla-now.vercel.app) · repo [`arjunkalee/dolla`](https://github.com/arjunkalee/dolla)  
**Date:** 2026-09-15  
**Kind:** docs-only spike. No Plaid SDK, no OAuth, no live bank sync in this PR.

Question: how should Arjun keep Dolla **checking / card balances and recent purchases** fresh on an iPhone PWA, without pretending Apple Pay works on the web?

This memo does **not** invent balances. Starting-ledger numbers stay the Aug 29, 2026 snapshot until Arjun edits or imports them.

---

## What Dolla already has (status quo)

| Path | In the PWA today? | What it covers |
|---|---|---|
| One-thumb **Log** | Yes | Any purchase, immediately. Checking + envelopes + leftover math update. |
| **CSV import** ([SCRUM-2](https://arjunkale.atlassian.net/browse/SCRUM-2)) | Yes — Profile upload/paste | Wallet/bank statement rows → ledger. Duplicate key `date\|amountCents\|normalizedMerchant`. Sample: `public/sample-apple-card.csv`. |
| **Chat** money edits | Yes | `checking is 5100`, `Apple Card is paid`, bill amounts. No LLM. |
| **Balances & bills** ([SCRUM-14](https://arjunkale.atlassian.net/browse/SCRUM-14), merged) | Yes — `/bills` | Edit checking + dated bills (BofA card, Apple Card, Amex, rent). America/Chicago **as of** after edit/import. Freshness UX **without** bank sync. |
| **Gmail auto-log** (Venmo / Uber / receipts) | Not in this repo | Personal Gmail already has those emails. Today they become Log rows or a CSV by hand (or a Cursor/Gmail helper), not an in-app Gmail OAuth ingest. |
| **BofA purchase alerts** | Not in this repo | Bank emails/texts exist. Same handoff: copy into Log, or export a statement CSV. |
| Notification-shade scrape | **Rejected** | Do not read iOS notifications. Fragile, against Apple rules, and a privacy mess. |

Spend accounts in play (investments out of scope for this spike): **BofA checking + Unlimited Cash Rewards**, **Apple Card**, **Amex Gold**, **Venmo**, **Zelle**. Robinhood / Vanguard / eTrade stay savings destinations, not a spend feed.

---

## Apple Pay push: not possible on web

**Apple Pay push: not possible on web.** There is no consumer web API that delivers Apple Pay / Wallet purchase notifications or history to a website or PWA.

- Apple Pay on the web is a **checkout** API (accepting a payment). It does not expose Arjun’s personal purchase history to third-party sites.
- **FinanceKit** (`FinanceStore` balances + transactions) is **native iOS only** (iPhone, iOS 17.4+). It needs an App Store app in the Finance category, a managed `com.apple.developer.financekit` entitlement from Apple, and on-device user consent. Eligible US products today: Apple Card, Apple Cash, Apple Savings — **not** BofA, Amex, or Venmo.
- A Vercel PWA cannot call FinanceKit, cannot subscribe to Wallet push, and cannot receive Apple Pay APNs. Add-to-Home-Screen does not change that.
- This is already documented in the README and on Profile. Dolla will not pretend otherwise.

Native later can unlock Apple Card **reads** via FinanceKit. It still does not magically get BofA/Amex/Venmo, and it still is not “Apple Pay push to the website.”

---

## 1. Plaid (or similar aggregator)

**What it is:** Link (bank login / OAuth UI) + Transactions (and optional Balance) so Dolla could pull BofA checking + cards, and likely Amex, without CSV.

**What data you get (Transactions):** posted (and some pending) transactions — date, amount, description, merchant (~97% fill), Plaid category (~95%), account/mask. Initial history default **90 days**, max **~24 months**. After that, Plaid polls the bank about **1–4×/day** and fires `SYNC_UPDATES_AVAILABLE` webhooks. Optional `/transactions/refresh` is a paid add-on for on-demand pulls. Balance can be a separate per-request product for a current available/current figure.

**BofA:** supported; US banks use **OAuth** (redirect to Bank of America, not typing the password into Plaid). Amex is on Plaid’s OAuth institution list. **Apple Card is not a Plaid Item** — Goldman/Apple Wallet data stays CSV or FinanceKit. Venmo via Plaid has historically been flaky; treat as maybe. Zelle shows up as BofA checking activity, not its own Item. Investments would be a different Plaid product — out of scope.

**Sandbox vs production:**

| Environment | Data | Cost | Notes |
|---|---|---|---|
| Sandbox | Mock banks only | Free | Fine to prototype Link. Useless for Arjun’s real BofA. |
| Trial (US/CA teams created on/after 2026-04-15) | Real Production Items, cap **10** | Free | Includes Transactions + Balance. Most OAuth banks (BofA, Amex) without the full security questionnaire. Identity verification; OAuth often live in 6–24h. |
| Paid Production (Pay-as-you-go) | Real, unlimited Items | Per-product | Transactions = **monthly subscription per Item** (connected login), not per API call. Exact list price is behind the Production application. Hobby-scale third-party ballpark is **tens of cents to a few dollars per Item / month** — for 2–4 Items that is **single-digit USD/month**, not a Growth/Custom **~$2k+/month** company contract. |

**Effort to ship on this Next.js/Vercel PWA (not doing it in this spike):**

- Client: Plaid Link (`react-plaid-link` or Hosted Link) inside the PIN session.
- Server routes: `/link/token/create`, `public_token` → `access_token` exchange, `/transactions/sync` with cursor, webhook URL on `dolla-now.vercel.app`.
- Secrets: `PLAID_CLIENT_ID` / `PLAID_SECRET` on Vercel; **encrypt `access_token`s** in Turso/KV (today the ledger is PIN-gated JSON, not a token vault).
- iPhone PWA OAuth pain: BofA OAuth opens Safari. Returning to the **standalone** Home Screen app is unreliable. Hosted Link helps; Universal Links / app-to-app really wants a native shell.
- Deduping against Log + CSV fingerprints, pending→posted mutations, webhook retries, Item error / re-Link when BofA drops the connection.

That is a **new product surface** (connect, disconnect, errors, “last synced”), not a weekend glue job. Similar aggregators (Teller, MX, Finicity) trade the same privacy/OAuth shape; Teller is often cheaper, MX/Finicity more bank-y. None of them give Apple Card.

**Privacy / trust:** Plaid (or Teller/MX) becomes a third party that can read BofA/Amex activity. BofA OAuth is better than sharing a password, but it is still a bank connection for a **one-person budget PWA**. Tokens in Dolla’s store are a new secret class. CSV/Log never leave Arjun’s PIN-gated Vercel + Turso/KV path except the files he already downloads.

**Fits current PWA?** Technically yes (Link web SDK + Vercel functions + webhooks). Practically a poor fit: OAuth bounce on iOS PWA, still no Apple Card, compliance/KYC if you leave Trial, and a lot of code for one user.

---

## 2. CSV + email alerts (status quo path)

**What it is:** keep Dolla as a ledger Arjun updates, using tools that already exist.

**CSV (in-app, SCRUM-2):** Profile → upload or paste. Apple Card Wallet export is the proven path (`test:csv` + sample file). Generic bank CSVs work when Date / Amount / Merchant columns exist; payments/credits are skipped. Gaps: BofA and Amex Gold column names are not first-class; no “set checking from this statement’s ending balance” prompt; [SCRUM-4](https://arjunkale.atlassian.net/browse/SCRUM-4) merchant→envelope mapping is still open.

**Balances & bills (in-app, SCRUM-14):** when the bank app shows a new checking or card-due number, type it once. As-of in America/Chicago is the honesty layer (“this is what I typed at 7:14 PM CT”), which is what felt missing — not a missing aggregator.

**Gmail / BofA alerts (adjacent, not in-repo):** Venmo, Uber, receipt forwards, and BofA purchase emails already land in Gmail. They are a **nudge to Log**, not a feed. Hardening this means a paste-parser or a documented “forward this alert → Log” habit — not Gmail API OAuth, and not reading the notification shade.

**Effort:** **Harden existing ingest** (days of work: BofA/Amex CSV maps, skip statement payments, optional checking as-of from a balance column). **Build new** (Gmail watch, Plaid, native) is weeks plus ongoing token/entitlement maintenance.

**Cost:** $0 beyond current Vercel + Turso/KV.

**Data quality:** As good as the export or the Log tap. CSV is posted-transaction accurate; it is not intra-day. Email alerts are fast but messy to parse (HTML, “pending”, foreign ATM fees). Duplicate fingerprint already protects re-imports. Apple Card stays first-class via Wallet CSV.

**Privacy:** Best of the three. No aggregator. Files Arjun already has. Gmail already has the receipts; Dolla does not need a Gmail token.

**Fits current PWA?** Yes. This is the product.

---

## 3. Native iOS later

**What a native shell would unlock:**

- **FinanceKit** for Apple Card / Apple Cash / Savings — on-device, user-consented, background updates. This is the only supported way to auto-ingest Apple Card. Entitlement is per bundle ID; app must be Finance-category App Store US/UK. Not a weekend wrapper around the PWA.
- More reliable **Plaid OAuth** (Universal Links, app-to-app BofA). Still optional; still no Apple Card from Plaid.
- A real home-screen app icon without Safari’s PWA quirks.

**What it would not unlock:**

- Apple Pay **push notifications** to a website (there is still no web API).
- BofA / Amex / Venmo via FinanceKit (US FinanceKit is Apple’s own products).
- A free pass to scrape the notification shade.

**Effort / cost:** Apple Developer Program, Swift/App Store, entitlement review, then keep the Vercel API as the ledger or move state. Months of product work relative to CSV hardening. Cost is time + $99/year, not Plaid.

**Fits current PWA?** No. It is a different client. Revisit only if Apple Card auto-ingest becomes the actual pain (Wallet CSV is too annoying) **and** Arjun wants an App Store app.

---

## Options table

| Option | Effort | Cost | Data coverage | Privacy | Fits current PWA? |
|---|---|---|---|---|---|
| **Plaid Link + Transactions** (BofA ± Amex) | High — Link, tokens, webhooks, iOS OAuth return, dedupe vs Log/CSV | Trial: $0 / 10 Items. Then ~single-digit USD/month hobby-scale, **or** company plans with $k/month floors. Engineering dominates. | BofA checking + Unlimited Cash Rewards: yes. Amex Gold: likely. Venmo: maybe. Zelle: via BofA. **Apple Card: no.** Intra-day-ish (bank poll 1–4×/day). | Aggregator + stored `access_token`s. Bank OAuth is cleaner than passwords, still a third party on a personal ledger. | Weak. Web SDK works on Vercel; **standalone iPhone PWA OAuth is the trap.** |
| **CSV + Log + as-of + email nudges** (status quo, harden) | Low–medium to harden; high if you build Gmail API ingest | $0 | Apple Card: Wallet CSV (proven). BofA/Amex: statement CSV + `/bills` as-of (needs column maps). Venmo/Uber/receipts: Gmail → Log. Not intra-day unless he Logs. | Best. PIN + durable store only. | **Yes.** |
| **Native iOS + FinanceKit later** | High — new app + Apple entitlement | Time + Apple Developer. FinanceKit itself is not a Plaid bill. | Apple Card/Cash/Savings: yes (if entitled). Other banks: still CSV or a separate aggregator. | On-device Wallet reads; still no shade scrape. | **No** — leaves the PWA. |

---

## Recommendation

**Do not ship live bank sync.** Keep Dolla a PIN-gated PWA. Use **SCRUM-14 as-of + Log + CSV**. Plaid does not solve Apple Card, fights iOS PWA OAuth, and adds a third party for one user. Native/FinanceKit is a later product decision, not the next ticket.

### Recommended next ticket (one)

**Title:** `CSV: BofA + Amex Gold statement import (no live bank sync)`

Draft for Arjun / CoS — do not implement in this spike.

**Acceptance (draft):**

- Profile CSV import maps a **Bank of America** checking or Unlimited Cash Rewards export and an **Amex Gold** export to date, amount, merchant, and envelope (or Uncategorized) without a custom mapper UI.
- Statement payments / credits are skipped; re-import uses the existing `date|amountCents|normalizedMerchant` fingerprint (same as Apple Card).
- If a BofA checking export includes an ending or available **balance** column, offer **Set checking to this** and stamp America/Chicago as-of — never invent a number if the column is missing.
- No Plaid SDK, no Gmail OAuth, no FinanceKit, no notification-shade scraping.

That is the cheapest way to cover the cards Plaid would actually get, while Apple Card stays on Wallet CSV, and `/bills` remains the balance freshness path.

---

## Out of scope (this spike)

- Implementing Plaid, Teller, MX, Gmail API, or FinanceKit
- Changing leftover math, PIN, or Vercel project
- Inventing or updating live balances
- Merging this PR to deploy (docs-only; no app behavior change)

## Sources

- [Plaid Transactions](https://plaid.com/docs/transactions/) · [Plaid billing](https://plaid.com/docs/account/billing/) · [Plaid Trial](https://support.plaid.com/hc/en-us/articles/39994173227159-What-is-the-Plaid-Trial-plan) · [OAuth institutions](https://support.plaid.com/hc/en-us/articles/15769780649751-How-do-I-get-access-to-OAuth-institutions)
- [Apple FinanceKit](https://developer.apple.com/financekit/)
- In-repo: `lib/csv.ts`, `components/profile-screen.tsx`, `components/balances-screen.tsx`, README “Purchase ingest (and Apple Pay)”
