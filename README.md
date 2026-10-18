# Dolla

Personal money for one person — Arjun Kale, America/Chicago. Monthly budgets, a biweekly paycheck plan, live purchase logging, and savings set-asides. Built as an iPhone-first PWA and meant to deploy on Vercel.

This is Arjun’s real ledger. Checking, dated bills, and envelopes load as of Aug 29, 2026. Profile → Reload starting ledger resets to that snapshot.

## What it does

- **Monthly envelopes** — rent, gas, groceries, dining, weekends, utilities, travel, misc.
- **Dated bills** — BofA, Apple Card, Amex, rent. Each can be assigned to this paycheck or the next.
- **Biweekly paycheck** — net $2,771.55 already inside checking. Do not count it twice.
- **Calendar** — paydays, bills, and logged spend. No leftover math on that tab.
- **Split** — this paycheck pours into bills, envelopes, and leftover-to-invest. Envelopes are a plan until you count them.
- **Two leftovers, never mixed** — leftover from this paycheck (can be negative) vs leftover in checking (prior cash plus the deposit). Every headline expands into labeled arithmetic.
- **Amex default off** — reserved from the next paycheck unless you toggle it.
- **Chat** — PIN-gated tab. Commands still edit the ledger: “log $10 dining”, “checking is 5100”, “Apple Card is paid”, “change groceries to 300”. Anything the parser does not recognize goes to Claude (read-only; it cannot edit yet) through `POST /api/assistant`. Suggested prompts sit above the composer. Short preferences (“I get paid on Fridays”) are saved next to the ledger and can be deleted on Profile. A monthly spend cap is tracked in the same durable store; Profile shows month-to-date spend, request count, and the last reset date.
- **Destinations** — eTrade, Roth, HYSA. 401k match is employer. Travel and Misc stay spend envelopes.
- **Live logging** — one-thumb Log. Checking, envelopes, and leftover formulas update immediately.

## Purchase ingest (and Apple Pay)

There is **no** consumer Apple Pay API for a website. Apple Pay does not expose personal purchase history to third-party web apps. Apple’s FinanceKit can read Wallet transactions only inside a **native iOS app** that has been granted an entitlement by Apple. This Vercel web app does not call Apple Pay or FinanceKit, and it will not pretend to.

Instead:

1. Log a purchase in the app (fast on iPhone).
2. Import a CSV export from Wallet (Apple Card), Bank of America (checking / Unlimited Cash Rewards), or Amex Gold — upload or paste on Profile (`/bills` links there). Samples live at `public/sample-apple-card.csv`, `public/sample-bofa.csv`, and `public/sample-amex-gold.csv`. Payments and credits are skipped. Re-import of the same rows is skipped (`date|amountCents|normalizedMerchant`). A BofA checking file with a running/ending balance can offer **Set checking to this** (America/Chicago as-of); Dolla never invents a balance if that column is missing.
3. Edit checking and dated bills on **Balances & bills** (`/bills`) so numbers show an America/Chicago **as of** without live bank sync.

Decision memo (Plaid vs CSV/email vs native; **Apple Pay push: not possible on web**): [`docs/SCRUM-15-bank-sync-spike.md`](docs/SCRUM-15-bank-sync-spike.md).

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Unlock uses the built-in salted PIN, checked on the server. Set `DOLLA_PIN` only to override that hash.

```bash
npm run build
npm start
npm run test:store
npm run test:csv
npm run test:assistant-evals
```

Local data is written to `data/dolla.json` (gitignored). On Vercel, `saveState` / `resetData("real")` go through Turso or Upstash — never `/tmp`.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DOLLA_PIN` | No | Optional override of the built-in salted PIN hash in `lib/auth.ts`. |
| `DOLLA_SESSION_SECRET` | Yes in production | Signs the session cookie. Use a long random string. |
| `TURSO_DATABASE_URL` | Turso option | libSQL/Turso URL. Either Turso or Upstash/KV is required for writes on Vercel. |
| `TURSO_AUTH_TOKEN` | With Turso | Turso auth token. |
| `KV_REST_API_URL` | Upstash/KV option | Vercel KV / Upstash Redis REST URL. Same role as `UPSTASH_REDIS_REST_URL`. |
| `KV_REST_API_TOKEN` | With KV | Pair with `KV_REST_API_URL`. Same role as `UPSTASH_REDIS_REST_TOKEN`. |
| `UPSTASH_REDIS_REST_URL` | Alias of `KV_REST_API_URL` | Injected by Upstash. `lib/store.ts` accepts either URL name. |
| `UPSTASH_REDIS_REST_TOKEN` | Alias of `KV_REST_API_TOKEN` | Pair with `UPSTASH_REDIS_REST_URL`. |
| `ANTHROPIC_API_KEY` | For the assistant | Server-only key for `POST /api/assistant`. Never sent to the phone. |
| `DOLLA_AI_MODEL` | No | Overrides the assistant model. Default is `claude-sonnet-5-5`. |
| `DOLLA_AI_MONTHLY_CAP_USD` | No | Assistant spend cap per Chicago month. Default `10`. |

On Vercel, pick **either** Turso **or** Upstash Redis. Without one of those, Dolla refuses to write (it will not use `/tmp`). The live project is **dolla-now** — do not create another project.

### Upstash Redis on dolla-now (do this)

1. Open [vercel.com/aura-a9f0/dolla-now](https://vercel.com/aura-a9f0/dolla-now).
2. Click **Storage**.
3. Click **Create Database** → **Upstash Redis** (Marketplace if Storage is empty).
4. Connect it to **dolla-now** only (not dolla, dolla-app, or dolla-budget).
5. Keep the injected `KV_REST_API_URL` / `KV_REST_API_TOKEN` or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`.
6. Redeploy production so the new env vars load.

### Turso (alternative)

1. Create a free database at [turso.tech](https://turso.tech).
2. Set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` on dolla-now.
3. Redeploy.

## Deploy on Vercel

1. Push this repo and import it in Vercel (Framework Preset: Next.js).
2. Set `DOLLA_SESSION_SECRET`. Set `DOLLA_PIN` only if you want to override the built-in hash.
3. Set Turso or KV as above.
4. Deploy. The production URL is gated by the PIN — it is not a public ledger.

## Add to Home Screen (iPhone)

1. Open the deployed URL in **Safari** (not Chrome).
2. Unlock with your PIN.
3. Share → **Add to Home Screen**.
4. Dolla opens standalone, with the dark status bar and the app icon.

The web app manifest and Apple touch icon are included. A service worker caches the shell for flaky networks; money data still loads from the server when you are online.

## First-week setup

The starting ledger is already his Aug 29, 2026 numbers. Confirm checking, tomorrow’s cards, rent due date, and the Amex toggle. Then log real spend. **Profile → Reload starting ledger** snaps back to that snapshot. Chat can change the same numbers; it never invents transactions.

Leftover from this paycheck (Aug 29 snapshot, Amex next check, envelopes not counted):

`2771.55 − 454.75 − 694.26 − 1432 = 190.54`

Leftover in checking:

`4952.01 − 454.75 − 694.26 − 1432 = 2371.00`

If Amex is reserved now, leftover checking is `$954.48`. Two-week envelopes are a plan on Split, not a leftover deduction unless opted in.

Timezone for every date is `America/Chicago`.
