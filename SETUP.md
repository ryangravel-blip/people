# People MRP Dashboard — setup

Live dashboard: queries Snowflake on every page load, no baked-in data. Same architecture
as `mrp_reports` (the main MRP dashboard) — a static `index.html` plus one Vercel serverless
function (`api/sql.js`) that authenticates to Snowflake with a JWT key pair.

## 1. Push this to GitHub

```
cd people-dashboard-repo
git init
git add .
git commit -m "Live People Team MRP dashboard"
git branch -M main
git remote add origin https://github.com/ryangravel-blip/people.git
git push -u origin main
```

## 2. Import into Vercel

In the Vercel dashboard: New Project -> Import `ryangravel-blip/people`. No framework preset
needed — `vercel.json` handles the build (it just copies `index.html` into `dist/`).

## 3. Set environment variables

In the new Vercel project's Settings -> Environment Variables, add:

| Variable | Value |
|---|---|
| `SNOWFLAKE_ACCOUNT` | same value as in the `mrp_reports` Vercel project |
| `SNOWFLAKE_USERNAME` | same value as in `mrp_reports` |
| `SNOWFLAKE_WAREHOUSE` | same value as in `mrp_reports` |
| `SNOWFLAKE_DATABASE` | same value as in `mrp_reports` (defaults to `load` if unset) |
| `SNOWFLAKE_ROLE` | same value as in `mrp_reports` |
| `SNOWFLAKE_PRIVATE_KEY` | the PEM private key contents, with `\n` for line breaks |

**On the private key:** `mrp_reports` has `rsa_key.p8` committed directly in the repo. That's
not great practice — anyone with repo access can read the raw key outside of Vercel's env var
store, and it can't be rotated without a commit. For this repo, don't commit a key file at all.
Either:
- reuse the same key pair and just paste the existing private key into `SNOWFLAKE_PRIVATE_KEY`, or
- generate a fresh key pair scoped to this dashboard and register the public key on the
  Snowflake user (`ALTER USER ... SET RSA_PUBLIC_KEY = '...'`), then set the private key here.

Either way, worth doing the same cleanup on `mrp_reports` at some point — pull the key out of
git history and into Vercel's env vars only.

## 4. Redeploy

Trigger a deploy (push a commit, or redeploy from the Vercel dashboard) after the env vars are
set — Vercel doesn't apply new env vars to an already-running deployment.

## What's live vs. what still needs manual updates

- P&L, headcount, vendor, and prepaid queries all use `CURRENT_DATE()`-relative logic, so
  "current month" rolls forward automatically.
- One exception: the Committed Spend tab's prepaid query hardcodes two column names
  (`'2026-05-31'` and `'2027-01-31'`) because `mrp_prepaid_spend` has one column per month-end
  date rather than a date field. Bump both literals in `Q.prepaid` inside `index.html` when you
  roll the period forward — same limitation the original snapshot version had.
