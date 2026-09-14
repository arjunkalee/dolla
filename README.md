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
- **Chat** — PIN-gated tab. Deterministic parser: “checking is 5100”, “rent is 1450”, “Apple Card is paid”, “change groceries to 300”. Confirms with the new number and leftover math. No LLM.
- **Destinations** — eTrade, Roth, HYSA. 401k match is employer. Travel and Misc stay spend envelopes.
- **Live logging** — one-thumb Log. Checking, envelopes, and leftover formulas update immediately.

## Purchase ingest (and Apple Pay)

There is **no** consumer Apple Pay API for a website. Apple Pay does not expose personal purchase history to third-party web apps. Apple’s FinanceKit can read Wallet transactions only inside a **native iOS app** that has been granted an entitlement by Apple. This Vercel web app does not call Apple Pay or FinanceKit, and it will not pretend to.

Instead:

1. Log a purchase in the app (fast on iPhone).
2. Import a CSV export from Wallet (Apple Card) or your bank — upload or paste on Profile. A sample file lives at `public/sample-apple-card.csv`. Re-import of the same rows is skipped (`date|amountCents|normalizedMerchant`).

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Default local PIN is `4826` (override with `DOLLA_PIN`).

```bash
npm run build
npm start
npm run test:store
npm run test:csv
```

Local data is written to `data/dolla.json` (gitignored). On Vercel, `saveState` / `resetData("real")` go through Turso or Upstash — never `/tmp`.

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DOLLA_PIN` | Yes in production | Unlock PIN or password. Local default is `4826` if unset. |
| `DOLLA_SESSION_SECRET` | Yes in production | Signs the session cookie. Use a long random string. |
| `TURSO_DATABASE_URL` | Turso option | libSQL/Turso URL. Either Turso or Upstash/KV is required for writes on Vercel. |
| `TURSO_AUTH_TOKEN` | With Turso | Turso auth token. |
| `KV_REST_API_URL` | Upstash/KV option | Vercel KV / Upstash Redis REST URL. Same role as `UPSTASH_REDIS_REST_URL`. |
| `KV_REST_API_TOKEN` | With KV | Pair with `KV_REST_API_URL`. Same role as `UPSTASH_REDIS_REST_TOKEN`. |
| `UPSTASH_REDIS_REST_URL` | Alias of `KV_REST_API_URL` | Injected by Upstash. `lib/store.ts` accepts either URL name. |
| `UPSTASH_REDIS_REST_TOKEN` | Alias of `KV_REST_API_TOKEN` | Pair with `UPSTASH_REDIS_REST_URL`. |

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
2. Set `DOLLA_PIN` and `DOLLA_SESSION_SECRET`.
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
