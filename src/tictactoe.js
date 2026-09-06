const MAX_PLAYERS = 2;
const STARTING_SCORE = 0;

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8], // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8], // cols
  [0, 4, 8], [2, 4, 6],            // diagonals
];

function checkWinner(board) {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { mark: board[a], line: [a, b, c] };
    }
  }
  return null;
}

function isDraw(board) {
  return board.every((cell) => cell !== null);
}

/**
 * One TicTacToeDurableObject instance == one game room, identified by its
 * room code. Same architecture as RoomDurableObject (Sambung Kata): the DO
 * holds all authoritative state (players, marks, board, turn) and clients
 * only ever see broadcast state — no client-side trust.
 */
export class TicTacToeDurableObject {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    /** @type {Map<string, WebSocket>} playerId -> socket */
    this.sockets = new Map();
    /** @type {Map<string, {name: string, mark: string|null, wins: number, connected: boolean}>} */
    this.players = new Map();
    this.turnOrder = []; // [playerId, playerId] once game starts, assigned X/O
    this.board = Array(9).fill(null);
    this.currentMark = "X";
    this.phase = "lobby"; // lobby | playing | ended
    this.winnerId = null;
    this.winLine = null;
    this.wasDraw = false;
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

    const activeCount = [...this.players.values()].filter((p) => p.connected).length;
    if (activeCount >= MAX_PLAYERS && this.phase === "lobby") {
      ws.send(JSON.stringify({ type: "error", message: "Room penuh (maks 2 pemain)." }));
      ws.close(1008, "room_full");
      return;
    }

    const playerId = crypto.randomUUID();
    this.sockets.set(playerId, ws);
    this.players.set(playerId, {
      name,
      mark: null,
      wins: STARTING_SCORE,
      connected: true,
    });
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

    const anyoneLeft = [...this.players.values()].some((pl) => pl.connected);
    if (!anyoneLeft) return;

    if (playerId === this.hostId) {
      const next = [...this.players.keys()].find(
        (id) => id !== playerId && this.players.get(id)?.connected
      );
      this.hostId = next || null;
    }

    // If a player leaves mid-game, the remaining player wins by forfeit.
    if (this.phase === "playing") {
      const opponentId = this.turnOrder.find((id) => id !== playerId);
      if (opponentId && this.players.get(opponentId)?.connected) {
        this.endGame(opponentId, false);
        return;
      }
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

      case "make_move":
        this.handleMove(playerId, msg.index);
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
    const active = [...this.players.entries()]
      .filter(([, p]) => p.connected)
      .map(([id]) => id);

    if (active.length !== 2) {
      this.sendTo(this.hostId, {
        type: "error",
        message: "Butuh tepat 2 pemain untuk memulai.",
      });
      return;
    }

    // Randomize who plays X (goes first) each game.
    const shuffled = Math.random() < 0.5 ? active : [active[1], active[0]];
    this.turnOrder = shuffled;
    this.players.get(shuffled[0]).mark = "X";
    this.players.get(shuffled[1]).mark = "O";

    this.board = Array(9).fill(null);
    this.currentMark = "X";
    this.phase = "playing";
    this.winnerId = null;
    this.winLine = null;
    this.wasDraw = false;

    this.broadcastState();
  }

  handleMove(playerId, index) {
    if (this.phase !== "playing") return;
    const p = this.players.get(playerId);
    if (!p || p.mark !== this.currentMark) return; // not your turn

    const i = Number(index);
    if (!Number.isInteger(i) || i < 0 || i > 8) return;
    if (this.board[i] !== null) return; // cell taken

    this.board[i] = p.mark;

    const result = checkWinner(this.board);
    if (result) {
      this.endGame(playerId, false, result.line);
      return;
    }

    if (isDraw(this.board)) {
      this.endGame(null, true);
      return;
    }

    this.currentMark = this.currentMark === "X" ? "O" : "X";
    this.broadcastEvent({ type: "move_made", playerId, index: i, mark: p.mark });
  }

  endGame(winnerId, draw, winLine = null) {
    this.phase = "ended";
    this.winnerId = winnerId;
    this.winLine = winLine;
    this.wasDraw = !!draw;
    if (winnerId) {
      const p = this.players.get(winnerId);
      if (p) p.wins += 1;
    }
    this.broadcastEvent({ type: "game_over", winnerId, draw: this.wasDraw, winLine });
  }

  resetForRematch() {
    this.phase = "lobby";
    this.board = Array(9).fill(null);
    this.currentMark = "X";
    this.winnerId = null;
    this.winLine = null;
    this.wasDraw = false;
    for (const p of this.players.values()) {
      p.mark = null;
    }
    this.turnOrder = [];
    this.broadcastState();
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
        mark: p.mark,
        wins: p.wins,
        connected: p.connected,
      })),
      board: this.board,
      currentMark: this.phase === "playing" ? this.currentMark : null,
      winnerId: this.winnerId,
      winLine: this.winLine,
      draw: this.wasDraw,
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
