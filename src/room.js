import { isValidWord } from "./dictionary.js";

const TURN_SECONDS = 15;
const MAX_PLAYERS = 6;
const STARTING_LIVES = 3;

/**
 * One RoomDurableObject instance == one game room, identified by its room
 * code. It holds all authoritative state: who's connected, whose turn it
 * is, the word chain so far, lives, and the turn timer. Clients only ever
 * see state that this object broadcasts — no client-side trust.
 */
export class RoomDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    /** @type {Map<string, WebSocket>} playerId -> socket */
    this.sockets = new Map();
    /** @type {Map<string, {name: string, lives: number, score: number, connected: boolean}>} */
    this.players = new Map();
    this.turnOrder = [];
    this.turnIndex = 0;
    this.chain = []; // { word, playerId }[]
    this.usedWords = new Set();
    this.phase = "lobby"; // lobby | playing | ended
    this.turnDeadline = null;
    this.turnTimeoutHandle = null;
    this.hostId = null;
    this.initialized = false;
  }

  // ---- Internal HTTP (from the main worker) ----
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/init") {
      this.initialized = true;
      return new Response("ok");
    }

    if (url.pathname === "/status") {
      return new Response(
        JSON.stringify({
          initialized: this.initialized,
          playerCount: this.players.size,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      this.initialized = true;
      const name = (url.searchParams.get("name") || "Pemain").slice(0, 16);
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      await this.handleSession(server, name);
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response("not found", { status: 404 });
  }

  async handleSession(ws, name) {
    ws.accept();

    if (this.players.size >= MAX_PLAYERS && this.phase === "lobby") {
      ws.send(JSON.stringify({ type: "error", message: "Room penuh." }));
      ws.close(1008, "room_full");
      return;
    }

    const playerId = crypto.randomUUID();
    this.sockets.set(playerId, ws);
    this.players.set(playerId, {
      name,
      lives: STARTING_LIVES,
      score: 0,
      connected: true,
    });
    this.turnOrder.push(playerId);
    if (!this.hostId) this.hostId = playerId;

    ws.send(JSON.stringify({ type: "welcome", playerId, hostId: this.hostId }));
    this.broadcastState();

    ws.addEventListener("message", (event) => {
      this.handleMessage(playerId, event.data).catch((err) => {
        console.error("message handling error", err);
      });
    });

    ws.addEventListener("close", () => this.handleDisconnect(playerId));
    ws.addEventListener("error", () => this.handleDisconnect(playerId));
  }

  handleDisconnect(playerId) {
    this.sockets.delete(playerId);
    const p = this.players.get(playerId);
    if (p) p.connected = false;

    // If everyone's gone, stop the turn timer so the DO can go idle/evict.
    const anyoneLeft = [...this.players.values()].some((pl) => pl.connected);
    if (!anyoneLeft) {
      this.clearTimer();
      return;
    }

    if (playerId === this.hostId) {
      const next = this.turnOrder.find(
        (id) => id !== playerId && this.players.get(id)?.connected
      );
      this.hostId = next || null;
    }

    this.broadcastState();
  }

  async handleMessage(playerId, raw) {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case "start_game":
        if (playerId === this.hostId && this.phase === "lobby") {
          this.startGame();
        }
        break;

      case "submit_word":
        this.handleWordSubmit(playerId, String(msg.word || ""));
        break;

      case "rematch":
        if (playerId === this.hostId && this.phase === "ended") {
          this.resetForRematch();
        }
        break;

      case "leave":
        this.handleDisconnect(playerId);
        try {
          this.sockets.get(playerId)?.close(1000, "left");
        } catch {}
        break;

      default:
        break;
    }
  }

  startGame() {
    const active = this.turnOrder.filter((id) => this.players.get(id)?.connected);
    if (active.length < 2) {
      this.sendTo(this.hostId, {
        type: "error",
        message: "Minimal 2 pemain untuk memulai.",
      });
      return;
    }
    this.turnOrder = active;
    this.turnIndex = 0;
    this.chain = [];
    this.usedWords = new Set();
    this.phase = "playing";
    for (const p of this.players.values()) {
      p.lives = STARTING_LIVES;
      p.score = 0;
    }
    this.beginTurn();
  }

  beginTurn() {
    this.clearTimer();
    // Skip disconnected/eliminated players
    let guard = 0;
    while (guard++ < this.turnOrder.length) {
      const currentId = this.turnOrder[this.turnIndex];
      const p = this.players.get(currentId);
      if (p && p.connected && p.lives > 0) break;
      this.advanceTurnIndex();
    }

    const remaining = this.turnOrder.filter(
      (id) => this.players.get(id)?.lives > 0 && this.players.get(id)?.connected
    );
    if (remaining.length <= 1) {
      this.endGame(remaining[0] || null);
      return;
    }

    this.turnDeadline = Date.now() + TURN_SECONDS * 1000;
    this.broadcastState();

    this.turnTimeoutHandle = setTimeout(() => {
      this.handleTimeout();
    }, TURN_SECONDS * 1000);
  }

  advanceTurnIndex() {
    this.turnIndex = (this.turnIndex + 1) % this.turnOrder.length;
  }

  handleTimeout() {
    const currentId = this.turnOrder[this.turnIndex];
    const p = this.players.get(currentId);
    if (p) {
      p.lives -= 1;
      this.broadcastEvent({
        type: "turn_result",
        playerId: currentId,
        ok: false,
        reason: "waktu_habis",
      });
    }
    this.advanceTurnIndex();
    this.beginTurn();
  }

  handleWordSubmit(playerId, rawWord) {
    if (this.phase !== "playing") return;
    const currentId = this.turnOrder[this.turnIndex];
    if (playerId !== currentId) return; // not your turn

    const word = rawWord.trim().toLowerCase();
    const p = this.players.get(playerId);
    const last = this.chain[this.chain.length - 1];
    const requiredLetter = last ? last.word[last.word.length - 1] : null;

    let ok = true;
    let reason = null;

    if (!word || !/^[a-z]+$/.test(word)) {
      ok = false;
      reason = "format_tidak_valid";
    } else if (requiredLetter && word[0] !== requiredLetter) {
      ok = false;
      reason = `harus_diawali_huruf_${requiredLetter}`;
    } else if (this.usedWords.has(word)) {
      ok = false;
      reason = "kata_sudah_dipakai";
    } else if (!isValidWord(word)) {
      ok = false;
      reason = "kata_tidak_dikenal";
    }

    if (ok) {
      this.chain.push({ word, playerId });
      this.usedWords.add(word);
      p.score += Math.max(10, word.length * 2);
      this.clearTimer();
      this.broadcastEvent({ type: "turn_result", playerId, ok: true, word });
      this.advanceTurnIndex();
      this.beginTurn();
    } else {
      p.lives -= 1;
      this.broadcastEvent({ type: "turn_result", playerId, ok: false, reason, word });
      this.clearTimer();
      this.advanceTurnIndex();
      this.beginTurn();
    }
  }

  endGame(winnerId) {
    this.phase = "ended";
    this.clearTimer();
    this.broadcastEvent({ type: "game_over", winnerId });
    this.broadcastState();
  }

  resetForRematch() {
    this.phase = "lobby";
    this.chain = [];
    this.usedWords = new Set();
    this.turnIndex = 0;
    for (const p of this.players.values()) {
      p.lives = STARTING_LIVES;
      p.score = 0;
    }
    this.broadcastState();
  }

  clearTimer() {
    if (this.turnTimeoutHandle) {
      clearTimeout(this.turnTimeoutHandle);
      this.turnTimeoutHandle = null;
    }
  }

  // ---- Broadcasting ----
  snapshotState() {
    return {
      type: "state",
      phase: this.phase,
      hostId: this.hostId,
      players: [...this.players.entries()].map(([id, p]) => ({
        id,
        name: p.name,
        lives: p.lives,
        score: p.score,
        connected: p.connected,
      })),
      turnOrder: this.turnOrder,
      currentPlayerId: this.phase === "playing" ? this.turnOrder[this.turnIndex] : null,
      chain: this.chain.slice(-25),
      turnDeadline: this.turnDeadline,
      turnSeconds: TURN_SECONDS,
    };
  }

  broadcastState() {
    this.broadcast(this.snapshotState());
  }

  broadcastEvent(evt) {
    this.broadcast(evt);
    this.broadcastState();
  }

  broadcast(payload) {
    const data = JSON.stringify(payload);
    for (const [id, ws] of this.sockets) {
      try {
        ws.send(data);
      } catch {
        this.sockets.delete(id);
      }
    }
  }

  sendTo(playerId, payload) {
    const ws = this.sockets.get(playerId);
    if (ws) {
      try {
        ws.send(JSON.stringify(payload));
      } catch {}
    }
  }
}
