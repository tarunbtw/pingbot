const { neon } = require("@neondatabase/serverless");

const sql = neon(process.env.DATABASE_URL);

exports.handler = async (event) => {
  const method = event.httpMethod;
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };

  // Handle CORS preflight
  if (method === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  // ── GET /api/urls ─────────────────────────────────────────────────────────
  if (method === "GET") {
    try {
      const rows = await sql`
        SELECT
          u.id,
          u.url,
          u.created_at,
          pl.status_code   AS last_status_code,
          pl.success       AS last_success,
          pl.pinged_at     AS last_pinged_at,
          pl.error_message AS last_error
        FROM urls u
        LEFT JOIN LATERAL (
          SELECT status_code, success, pinged_at, error_message
          FROM ping_logs
          WHERE url_id = u.id
          ORDER BY pinged_at DESC
          LIMIT 1
        ) pl ON TRUE
        ORDER BY u.created_at DESC
      `;
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify(rows),
      };
    } catch (err) {
      console.error("GET /api/urls error:", err);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to fetch URLs." }),
      };
    }
  }

  // ── POST /api/urls ────────────────────────────────────────────────────────
  if (method === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Invalid JSON body." }),
      };
    }

    const url = (body.url || "").trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          error: "URL must start with http:// or https://",
        }),
      };
    }

    try {
      const [row] = await sql`
        INSERT INTO urls (url) VALUES (${url}) RETURNING *
      `;
      return {
        statusCode: 201,
        headers,
        body: JSON.stringify(row),
      };
    } catch (err) {
      // Postgres unique violation code = 23505
      if (err.code === "23505") {
        return {
          statusCode: 409,
          headers,
          body: JSON.stringify({ error: "This URL is already being monitored." }),
        };
      }
      console.error("POST /api/urls error:", err);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to add URL." }),
      };
    }
  }

  // ── DELETE /api/urls ──────────────────────────────────────────────────────
  if (method === "DELETE") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Invalid JSON body." }),
      };
    }

    const id = parseInt(body.id, 10);
    if (!id || isNaN(id)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: "Missing or invalid id." }),
      };
    }

    try {
      // FIX: the neon serverless driver does NOT return a `.count` property
      // on plain DELETE queries — `result` was always an array, so
      // `result.count` was always `undefined`, and the 404 branch below
      // never fired (deleting a non-existent id silently returned 200).
      // Using RETURNING + checking array length gives an accurate result.
      const result = await sql`DELETE FROM urls WHERE id = ${id} RETURNING id`;
      if (result.length === 0) {
        return {
          statusCode: 404,
          headers,
          body: JSON.stringify({ error: "URL not found." }),
        };
      }
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ deleted: true }),
      };
    } catch (err) {
      console.error("DELETE /api/urls error:", err);
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Failed to delete URL." }),
      };
    }
  }

  // ── 405 for everything else ───────────────────────────────────────────────
  return {
    statusCode: 405,
    headers,
    body: JSON.stringify({ error: "Method not allowed." }),
  };
};
