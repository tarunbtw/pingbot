# PingBot

A minimal uptime tool that pings a list of URLs on a fixed interval to prevent free-tier hosting platforms from suspending idle services.

## Overview

Many free hosting tiers (Render, Railway, Fly.io, etc.) suspend web services after a period of inactivity, causing a slow cold start on the next request. PingBot addresses this by periodically sending a request to each registered URL, keeping the target service warm.

The system has no persistent server component. A scheduled external trigger invokes a serverless function, which reads the URL list from the database and issues requests to each one in parallel.

## Architecture

```
Browser (dashboard.html)
    |
    | add / list / delete URLs
    v
Netlify Function: urls.js  ---->  Neon Postgres
                                       ^
                                       |
cron-job.org (every 2 min)             |
    |                                  |
    v                                  |
Netlify Function: ping-all.js  --------+
    |
    v
Target URLs (fetched in parallel, 7s timeout each)
```

## Stack

| Component | Technology |
|---|---|
| Hosting | Netlify (static site + Functions) |
| Database | Neon (serverless Postgres) |
| Database driver | `@neondatabase/serverless` |
| Frontend | HTML, CSS, vanilla JavaScript |
| Scheduler | cron-job.org (external, free tier) |

No frontend framework, no build step, no backend server process, no authentication layer beyond a shared secret on the ping endpoint.

## Project structure

```
pingbot/
├── netlify.toml               Netlify build config and /api redirect
├── package.json               Dependencies
├── schema.sql                 Database schema (run once in Neon)
├── .gitignore
├── netlify/
│   └── functions/
│       ├── urls.js            CRUD endpoint for monitored URLs
│       └── ping-all.js        Pings all URLs, called by the scheduler
└── public/
    ├── index.html             Landing page
    ├── dashboard.html          URL management interface
    ├── style.css               Shared styles
    └── app.js                 Dashboard client logic
```

## Database schema

Two tables:

- `urls` — the list of monitored endpoints.
- `ping_logs` — a bounded history (last 20 entries per URL) of ping results, used to display status on the dashboard.

Full definitions are in `schema.sql`.

## API

### `GET /api/urls`
Returns all monitored URLs with their most recent ping result.

### `POST /api/urls`
Adds a URL. Body: `{ "url": "https://..." }`. Returns `409` on duplicate, `400` on invalid input.

### `DELETE /api/urls`
Removes a URL. Body: `{ "id": <number> }`. Returns `404` if the id does not exist.

### `GET /api/ping-all?secret=<PING_SECRET>`
Pings every monitored URL in parallel and records the results. Requires the correct `PING_SECRET`; returns `401` otherwise. Intended to be called only by the external scheduler.

## Environment variables

Set these in Netlify under Site settings → Environment variables. A redeploy is required after adding or changing them.

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon Postgres connection string (pooled connection recommended) |
| `PING_SECRET` | Shared secret required to invoke `/api/ping-all` |

For local development, copy `.env.example` to `.env` and fill in the same values.

## Deployment

1. **Database**: Create a project on Neon. Open the SQL editor and run the contents of `schema.sql`. Copy the pooled connection string.
2. **Repository**: Push this project to a GitHub repository.
3. **Netlify**: Create a new site from the GitHub repository. Build settings are read from `netlify.toml`; no build command is required.
4. **Environment variables**: In the Netlify dashboard, add `DATABASE_URL` and `PING_SECRET`. Trigger a new deploy so the running functions pick up the values.
5. **Scheduler**: On cron-job.org, create a job targeting `https://<your-site>/api/ping-all?secret=<PING_SECRET>`, method `GET`, interval of 2 minutes.
6. **Verify**: Confirm `GET /api/urls` returns `[]` on a fresh database, and that the cron job's execution log shows `200` responses.

Subsequent pushes to the connected branch trigger automatic redeploys; no manual steps are needed after initial setup.

## Design notes

- The ping endpoint treats any HTTP response, including 4xx and 5xx, as a successful wake-up. Only network failures or timeouts are recorded as failures, since the goal is to confirm the target service responded at all.
- Ping results are capped at 20 per URL to keep the database small; older entries are pruned on each run.
- The `PING_SECRET` check is a basic access control, not a security boundary. It exists to prevent the ping endpoint from being invoked arbitrarily and consuming database and outbound request quota.

## Limitations

- Single-user tool. No authentication on the dashboard or the URL management endpoints.
- No validation against internal or private network addresses in submitted URLs.
- No alerting on repeated ping failures; status is visible only on the dashboard.