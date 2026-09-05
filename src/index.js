/**
 * Sambung Kata — Cloudflare Worker entry point.
 *
 * Routes:
 *   POST /api/room               -> create a new room, returns { code }
 *   GET  /api/room/:code/exists  -> check if a room code is valid
 *   GET  /ws/:code?name=...      -> upgrade to WebSocket, join room :code
 *
 * All room state (players, turn order, timers, word chain, scoring) lives
 * inside the RoomDurableObject so every player in a room talks to the same
 * single-threaded object — no external DB needed for realtime sync.
 */

import { RoomDurableObject } from "./room.js";

export { RoomDurableObject };

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

    // --- Create room ---
    if (url.pathname === "/api/room" && request.method === "POST") {
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
      const code = wsMatch[1].toUpperCase();
      const id = env.ROOMS.idFromName(code);
      const stub = env.ROOMS.get(id);
      return stub.fetch(request);
    }

    return json({ error: "not_found" }, { status: 404 });
  },
};
