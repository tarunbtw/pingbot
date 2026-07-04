const { neon } = require("@neondatabase/serverless");

const sql = neon(process.env.DATABASE_URL);
const PING_TIMEOUT_MS = 7000; // 7 seconds per request
const MAX_LOGS_PER_URL = 20;

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };

  // ── 1. Authenticate via PING_SECRET ──────────────────────────────────────
  const secret = process.env.PING_SECRET;
  const providedHeader = event.headers["x-ping-secret"];
  const providedQuery = (event.queryStringParameters || {}).secret;
  const provided = providedHeader || providedQuery;

  if (!secret || provided !== secret) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: "Unauthorized." }),
    };
  }

  // ── 2. Load all URLs ─────────────────────────────────────────────────────
  let urls;
  try {
    urls = await sql`SELECT id, url FROM urls`;
  } catch (err) {
    console.error("ping-all: failed to query URLs:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Failed to load URLs from database." }),
    };
  }

  if (urls.length === 0) {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ pinged: 0, results: [] }),
    };
  }

  // ── 3. Ping all URLs in parallel ─────────────────────────────────────────
  const pingOne = async ({ id: urlId, url }) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);

    try {
      const res = await fetch(url, {
        method: "GET",
        signal: controller.signal,
        redirect: "follow",
      });
      clearTimeout(timer);
      return { urlId, url, success: true, statusCode: res.status, error: null };
    } catch (err) {
      clearTimeout(timer);
      const isTimeout = err.name === "AbortError";
      return {
        urlId,
        url,
        success: false,
        statusCode: null,
        error: isTimeout ? "Request timed out" : err.message,
      };
    }
  };

  const settled = await Promise.allSettled(urls.map(pingOne));

  const results = settled.map((s) =>
    s.status === "fulfilled"
      ? s.value
      : { urlId: null, url: "unknown", success: false, statusCode: null, error: String(s.reason) }
  );

  // ── 4. Prune and Insert logs ─────────────────────────────────────────────
  await Promise.allSettled(
    results.map(async ({ urlId, success, statusCode, error }) => {
      if (!urlId) return;
      try {
        // Insert new log row
        await sql`
          INSERT INTO ping_logs (url_id, status_code, success, error_message)
          VALUES (${urlId}, ${statusCode}, ${success}, ${error || null})
        `;
        // Prune: keep only the most recent MAX_LOGS_PER_URL rows
        await sql`
          DELETE FROM ping_logs
          WHERE id IN (
            SELECT id FROM ping_logs
            WHERE url_id = ${urlId}
            ORDER BY pinged_at DESC
            OFFSET ${MAX_LOGS_PER_URL}
          )
        `;
      } catch (err) {
        console.error(`ping-all: failed to log result for url_id ${urlId}:`, err);
      }
    })
  );

  // ── 5. Return summary ────────────────────────────────────────────────────
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      pinged: results.length,
      results: results.map(({ url, success, statusCode }) => ({
        url,
        success,
        status_code: statusCode,
      })),
    }),
  };
};
