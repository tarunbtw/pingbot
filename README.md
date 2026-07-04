# PingBot ⚡

A minimal, self-hosted tool to keep free-tier apps (Render, Railway, Fly.io, etc.) alive by pinging them every 2 minutes.

**No always-on server. No auth. No framework.** Pure HTML + Netlify Functions + Neon Postgres.

---

## What changed in this version

This build was reviewed for bugs and reshaped into a landing page + dashboard. Changes from the previous version:

### Bug fixes

1. **`/api/*` requests were 404ing.** `netlify.toml` had no redirect rule, and Netlify Functions are served at `/.netlify/functions/<name>` by default — not `/api/<name>`. The frontend calls `/api/urls`, so every request would have failed once deployed. **Fixed** by adding:
   ```toml
   [[redirects]]
     from = "/api/*"
     to = "/.netlify/functions/:splat"
     status = 200
   ```

2. **Deleting a non-existent URL silently returned success.** The DELETE handler checked `result.count === 0` to return a 404, but the Neon serverless driver doesn't return a `.count` property on a plain `DELETE` — so `result.count` was always `undefined`, and the 404 branch never ran. **Fixed** by changing the query to `DELETE ... RETURNING id` and checking `result.length === 0` instead.

Everything else — the ping logic, timeout handling, parallel fetches, log pruning, and the `PING_SECRET` check — was verified correct and left as-is.

### Structural change: landing page + dashboard

Previously the single `index.html` was both the marketing page and the URL manager. It's now split:

- **`index.html`** — a minimal, monochrome landing page. One-line pitch, a live "next sweep" indicator (cosmetic — it just mirrors the real 2-minute cron interval, it doesn't call any API), and an **Open dashboard** button.
- **`dashboard.html`** — the actual URL manager (add / view / delete, ping status). Has a "← Home" link back to the landing page.

Visual style was redone in a monochrome, shadcn/ui-inspired palette (zinc grays, inverted black/white buttons, subtle borders, no color accents except the semantic green/red ping-status indicators, which carry real meaning and were kept).

---

## How it works

```
[Browser: index.html] ──► click "Open dashboard" ──► [dashboard.html: manage URLs] ──► [Neon Postgres]
                                                                                              ▲
                                                                                              │
                              [cron-job.org, every 2 min] ──► [Netlify Function: /api/ping-all]
                                                                ↳ reads all URLs → fetches each one in parallel
```

1. You open the dashboard and add URLs.
2. Every 2 minutes, cron-job.org triggers `/api/ping-all`.
3. That function reads your URLs from Neon, fires a GET to each one (parallel, 7s timeout each), and logs the result.
4. The dashboard shows last-ping time and status per URL.

---

## Stack

| Layer     | Technology                          |
|-----------|--------------------------------------|
| Hosting   | Netlify (static + Functions)         |
| Database  | Neon (serverless Postgres, free)     |
| DB driver | `@neondatabase/serverless`           |
| Frontend  | Plain HTML + CSS + vanilla JS        |
| Scheduler | cron-job.org (external, free)        |

---

## Project structure

```
pingbot/
├── netlify.toml              # Netlify build + functions + /api redirect
├── package.json
├── public/
│   ├── index.html            # Landing page ("Open dashboard" CTA)
│   ├── dashboard.html        # URL manager UI
│   ├── style.css             # Shared monochrome styles
│   └── app.js                # Dashboard logic (vanilla JS)
├── netlify/
│   └── functions/
│       ├── urls.js           # GET / POST / DELETE URLs
│       └── ping-all.js       # Ping all URLs (called by cron)
└── schema.sql                # DB schema — run once in Neon SQL console
```

---

## Deployment

### 1. Create the Neon database

1. Sign up at [neon.tech](https://neon.tech) (free).
2. Create a new project.
3. Open the **SQL Editor** and paste + run the contents of `schema.sql`.
4. Copy your connection string from the dashboard (looks like `postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`).

### 2. Deploy to Netlify

1. Push this repo to GitHub.
2. Go to [app.netlify.com](https://app.netlify.com) → **Add new site → Import an existing project**.
3. Connect your GitHub repo.
4. Build settings are auto-detected from `netlify.toml` (no build command needed).
5. Click **Deploy site**.

### 3. Set environment variables

In Netlify: **Site settings → Environment variables → Add a variable**:

| Variable       | Value                                                    |
|----------------|-----------------------------------------------------------|
| `DATABASE_URL` | Your Neon connection string                                |
| `PING_SECRET`  | A random secret (generate with `openssl rand -hex 16`)    |

Redeploy the site after adding these.

### 4. Verify the functions

```bash
# List URLs (should return an empty array on a fresh DB)
curl https://<your-site>.netlify.app/api/urls

# Add a test URL
curl -X POST https://<your-site>.netlify.app/api/urls \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}'

# Trigger a ping (replace YOUR_SECRET)
curl "https://<your-site>.netlify.app/api/ping-all?secret=YOUR_SECRET"

# Confirm deleting a non-existent id correctly returns 404 (regression check)
curl -X DELETE https://<your-site>.netlify.app/api/urls \
  -H "Content-Type: application/json" \
  -d '{"id":999999}'
```

### 5. Set up cron-job.org

1. Sign up at [cron-job.org](https://cron-job.org) (free).
2. Create a new cronjob:
   - **URL**: `https://<your-site>.netlify.app/api/ping-all?secret=<PING_SECRET>`
   - **Execution schedule**: Every 2 minutes
   - **Request method**: GET
3. Enable the job and save.

### 6. Test end-to-end

1. Open `https://<your-site>.netlify.app` — confirm the landing page loads and the "Open dashboard" button works.
2. Add a couple of URLs through the dashboard.
3. Wait 2–4 minutes, refresh — you should see status and last-ping timestamps.

---

## Environment variables reference

| Variable       | Required | Description                                              |
|----------------|----------|------------------------------------------------------------|
| `DATABASE_URL` | ✅ Yes   | Neon connection string (`postgresql://...`)                |
| `PING_SECRET`  | ✅ Yes   | Secret checked by `/api/ping-all`, sent by cron-job.org as `?secret=...` |

---

## API reference

### `GET /api/urls`
Returns all monitored URLs with their latest ping status.

### `POST /api/urls`
Add a URL. Body: `{ "url": "https://..." }`. Returns `201`, or `400`/`409` on validation/duplicate errors.

### `DELETE /api/urls`
Remove a URL. Body: `{ "id": 1 }`. Returns `200` on success, `404` if the id doesn't exist (fixed — see above).

### `GET /api/ping-all?secret=<PING_SECRET>`
Pings all monitored URLs in parallel and logs results. Returns `401` if the secret is missing or wrong.

---

## Known limitations (by design)

- Single user, no auth beyond the `PING_SECRET` on the ping endpoint — do not treat this as a security boundary for anything sensitive.
- No SSRF protection on the URL field — anyone with dashboard access could add an internal/local URL. Irrelevant for a single-user tool on a private dashboard, but worth knowing if you ever expose this more broadly.
- No alerting on ping failure (email/Slack) — check the dashboard manually.

## Non-goals

- No user accounts.
- No React, Vue, or any frontend framework.
- No persistent server or Docker container.
- No Redis, queues, or background workers.
