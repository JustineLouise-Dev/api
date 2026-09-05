/**
 * Sambung Kata — Cloudflare Worker entry point.
 *
 * Routes:
 *   POST /api/room               -> create a new room, returns { code }
 *   GET  /api/room/:code/exists  -> check if a room code is valid
 *   GET  /ws/:code?name=...      -> upgrade to WebSocket, join room :code
 *   GET  /api/visits             -> (admin only) list logged connection hits
 *
 * All room state (players, turn order, timers, word chain, scoring) lives
 * inside the RoomDurableObject so every player in a room talks to the same
 * single-threaded object — no external DB needed for realtime sync.
 *
 * Every /api/room, /exists, and /ws upgrade hit is also fire-and-forget
 * logged (raw connection details only, no bot scoring/judgement) into a
 * single global VisitLogDurableObject for inspection via admin.html.
 */

import { RoomDurableObject } from "./room.js";
import { VisitLogDurableObject } from "./visitlog.js";

export { RoomDurableObject, VisitLogDurableObject };

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
      ...(init.headers || {}),
    },
  });
}

function getVisitLogStub(env) {
  const id = env.VISIT_LOG.idFromName("global");
  return env.VISIT_LOG.get(id);
}

const PASSWORD_ITERATIONS = 100000;

function encodeBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: PASSWORD_ITERATIONS, hash: "SHA-256" },
    key,
    256
  );
  return encodeBase64(new Uint8Array(bits));
}

async function hashRequestPassword(request, salt) {
  const password = request.headers.get("X-Admin-Key") || "";
  return hashPassword(password, salt);
}

/**
 * Cloudflare's CF-Connecting-IP passes through whatever the client actually
 * connected with — no normalization to IPv4. This just classifies the
 * string so the admin panel can filter by it.
 */
function detectIpVersion(ip) {
  if (!ip) return "";
  if (ip.includes(":")) return "IPv6";
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return "IPv4";
  return "";
}

/**
 * Fire-and-forget log of a connection hit. Never awaited by the caller in a
 * way that could slow down or fail the real response — errors are swallowed.
 */
function logVisit(request, env, path) {
  try {
    const cf = request.cf || {};
    const headers = request.headers;
    const ip = headers.get("CF-Connecting-IP") || "";
    const row = {
      time: Date.now(),
      ip,
      ipVersion: detectIpVersion(ip),
      method: request.method,
      path,
      userAgent: headers.get("User-Agent") || "",
      country: cf.country || "",
      city: cf.city || "",
      region: cf.region || "",
      colo: cf.colo || "",
      asn: cf.asn != null ? String(cf.asn) : "",
      asOrganization: cf.asOrganization || "",
      tlsVersion: cf.tlsVersion || "",
      httpProtocol: cf.httpProtocol || "",
      acceptLanguage: headers.get("Accept-Language") || "",
      accept: headers.get("Accept") || "",
      referer: headers.get("Referer") || "",
      secFetchSite: headers.get("Sec-Fetch-Site") || "",
      secFetchMode: headers.get("Sec-Fetch-Mode") || "",
      secFetchDest: headers.get("Sec-Fetch-Dest") || "",
      headersJson: JSON.stringify(Object.fromEntries(headers.entries())),
    };
    const stub = getVisitLogStub(env);
    // Don't await — logging should never block or break the real request.
    stub
      .fetch("https://internal/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(row),
      })
      .catch((err) => console.error("visit log error", err));
  } catch (err) {
    console.error("visit log build error", err);
  }
}

function randomRoomCode() {
  // 5-char code, avoids ambiguous chars (0/O, 1/I/L)
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // --- Admin panel ---
    if ((url.pathname === "/admin" || url.pathname === "/admin.html") && request.method === "GET") {
      return env.ASSETS.fetch(new Request(new URL("/admin.html", request.url), request));
    }

    // --- Admin: configure password ---
    if (url.pathname === "/api/admin/status" && request.method === "GET") {
      const stub = getVisitLogStub(env);
      const upstream = await stub.fetch("https://internal/admin-status");
      return json(await upstream.json());
    }

    if (url.pathname === "/api/admin/setup" && request.method === "POST") {
      const { password } = await request.json();
      if (typeof password !== "string" || password.length < 8) {
        return json({ error: "password_too_short" }, { status: 400 });
      }
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const passwordHash = await hashPassword(password, salt);
      const stub = getVisitLogStub(env);
      const upstream = await stub.fetch("https://internal/admin-setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ salt: encodeBase64(salt), passwordHash }),
      });
      return json(await upstream.json(), { status: upstream.status });
    }

    // --- Admin: list logged visits ---
    if (url.pathname === "/api/visits" && request.method === "GET") {
      const stub = getVisitLogStub(env);
      const statusResponse = await stub.fetch("https://internal/admin-status");
      const status = await statusResponse.json();
      if (!status.configured) {
        return json({ error: "unauthorized" }, { status: 401 });
      }
      const settingsResponse = await stub.fetch("https://internal/admin-settings");
      const settings = await settingsResponse.json();
      const salt = settings.salt;
      if (!salt) return json({ error: "unauthorized" }, { status: 401 });
      const passwordHash = await hashRequestPassword(request, decodeBase64(salt));
      const auth = await stub.fetch("https://internal/admin-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passwordHash }),
      });
      if (!(await auth.json()).authorized) {
        return json({ error: "unauthorized" }, { status: 401 });
      }
      const upstream = await stub.fetch("https://internal/list?" + url.searchParams.toString());
      const data = await upstream.json();
      return json(data);
    }

    // --- Create room ---
    if (url.pathname === "/api/room" && request.method === "POST") {
      logVisit(request, env, url.pathname);
      let code = randomRoomCode();
      // Extremely unlikely collision, but loop a couple times just in case
      // by asking the DO itself whether it already has players.
      for (let attempt = 0; attempt < 5; attempt++) {
        const id = env.ROOMS.idFromName(code);
        const stub = env.ROOMS.get(id);
        const res = await stub.fetch("https://internal/status");
        const status = await res.json();
        if (!status.initialized) break;
        code = randomRoomCode();
      }
      const id = env.ROOMS.idFromName(code);
      const stub = env.ROOMS.get(id);
      await stub.fetch("https://internal/init", { method: "POST" });
      return json({ code });
    }

    // --- Check room exists ---
    const existsMatch = url.pathname.match(/^\/api\/room\/([A-Z0-9]+)\/exists$/i);
    if (existsMatch && request.method === "GET") {
      logVisit(request, env, url.pathname);
      const code = existsMatch[1].toUpperCase();
      const id = env.ROOMS.idFromName(code);
      const stub = env.ROOMS.get(id);
      const res = await stub.fetch("https://internal/status");
      const status = await res.json();
      return json({ exists: !!status.initialized, playerCount: status.playerCount || 0 });
    }

    // --- WebSocket upgrade into a room ---
    const wsMatch = url.pathname.match(/^\/ws\/([A-Z0-9]+)$/i);
    if (wsMatch) {
      logVisit(request, env, url.pathname);
      const code = wsMatch[1].toUpperCase();
      const id = env.ROOMS.idFromName(code);
      const stub = env.ROOMS.get(id);
      return stub.fetch(request);
    }

    return json({ error: "not_found" }, { status: 404 });
  },
};
