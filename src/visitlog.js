/**
 * VisitLogDurableObject
 *
 * A single global Durable Object instance that records raw connection
 * details for incoming HTTP hits (room creation, room-exists checks, and
 * WebSocket upgrades). It intentionally does NOT compute a "bot score" or
 * make a bot/human judgement — it just captures the request's connection
 * fingerprint (IP, User-Agent, Cloudflare edge metadata, relevant headers)
 * so a human can inspect and decide for themselves via the admin panel.
 *
 * Storage: uses the DO's attached SQLite storage (same mechanism as
 * RoomDurableObject) so no external DB/KV is needed. Rows older than
 * MAX_ROWS are trimmed on write to keep storage bounded.
 */

const MAX_ROWS = 5000;

export class VisitLogDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sql = state.storage.sql;
    this.ready = this.state.blockConcurrencyWhile(async () => {
      this.sql.exec(`
        CREATE TABLE IF NOT EXISTS visits (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          time INTEGER NOT NULL,
          ip TEXT,
          ipVersion TEXT,
          method TEXT,
          path TEXT,
          userAgent TEXT,
          country TEXT,
          city TEXT,
          region TEXT,
          colo TEXT,
          asn TEXT,
          asOrganization TEXT,
          tlsVersion TEXT,
          httpProtocol TEXT,
          acceptLanguage TEXT,
          accept TEXT,
          referer TEXT,
          secFetchSite TEXT,
          secFetchMode TEXT,
          secFetchDest TEXT,
          headersJson TEXT
        )
      `);
      this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_visits_time ON visits(time)`);
      this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_visits_ip ON visits(ip)`);
    });
  }

  async fetch(request) {
    await this.ready;
    const url = new URL(request.url);

    if (url.pathname === "/record" && request.method === "POST") {
      const row = await request.json();
      this.insert(row);
      return new Response("ok");
    }

    if (url.pathname === "/list" && request.method === "GET") {
      return this.list(url.searchParams);
    }

    return new Response("not found", { status: 404 });
  }

  insert(row) {
    this.sql.exec(
      `INSERT INTO visits (
        time, ip, ipVersion, method, path, userAgent, country, city, region, colo,
        asn, asOrganization, tlsVersion, httpProtocol, acceptLanguage,
        accept, referer, secFetchSite, secFetchMode, secFetchDest, headersJson
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      row.time,
      row.ip,
      row.ipVersion,
      row.method,
      row.path,
      row.userAgent,
      row.country,
      row.city,
      row.region,
      row.colo,
      row.asn,
      row.asOrganization,
      row.tlsVersion,
      row.httpProtocol,
      row.acceptLanguage,
      row.accept,
      row.referer,
      row.secFetchSite,
      row.secFetchMode,
      row.secFetchDest,
      row.headersJson
    );

    // Trim oldest rows beyond MAX_ROWS so storage stays bounded.
    const countResult = [...this.sql.exec(`SELECT COUNT(*) as c FROM visits`)];
    const count = countResult[0]?.c || 0;
    if (count > MAX_ROWS) {
      const excess = count - MAX_ROWS;
      this.sql.exec(
        `DELETE FROM visits WHERE id IN (SELECT id FROM visits ORDER BY id ASC LIMIT ?)`,
        excess
      );
    }
  }

  list(params) {
    const ipFilter = params.get("ip");
    const ipVersionFilter = params.get("ipVersion"); // "IPv4" | "IPv6"
    const limit = Math.min(parseInt(params.get("limit") || "300", 10) || 300, 1000);

    let query = `SELECT * FROM visits`;
    const conditions = [];
    const args = [];

    if (ipFilter) {
      conditions.push(`ip LIKE ?`);
      args.push(`%${ipFilter}%`);
    }
    if (ipVersionFilter === "IPv4" || ipVersionFilter === "IPv6") {
      conditions.push(`ipVersion = ?`);
      args.push(ipVersionFilter);
    }

    if (conditions.length) {
      query += ` WHERE ` + conditions.join(" AND ");
    }
    query += ` ORDER BY time DESC LIMIT ?`;
    args.push(limit);

    const rows = [...this.sql.exec(query, ...args)];

    const totalResult = [...this.sql.exec(`SELECT COUNT(*) as c FROM visits`)];
    const total = totalResult[0]?.c || 0;

    const visits = rows.map((r) => ({
      time: r.time,
      ip: r.ip,
      ipVersion: r.ipVersion,
      method: r.method,
      path: r.path,
      userAgent: r.userAgent,
      country: r.country,
      city: r.city,
      region: r.region,
      colo: r.colo,
      asn: r.asn,
      asOrganization: r.asOrganization,
      tlsVersion: r.tlsVersion,
      httpProtocol: r.httpProtocol,
      acceptLanguage: r.acceptLanguage,
      accept: r.accept,
      referer: r.referer,
      secFetchSite: r.secFetchSite,
      secFetchMode: r.secFetchMode,
      secFetchDest: r.secFetchDest,
      headers: safeParse(r.headersJson),
    }));

    return new Response(
      JSON.stringify({
        visits,
        summary: { total },
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }
}

function safeParse(json) {
  try {
    return JSON.parse(json || "{}");
  } catch {
    return {};
  }
}
