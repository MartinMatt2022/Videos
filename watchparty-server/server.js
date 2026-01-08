import express from "express";
import http from "http";
import { WebSocketServer } from "ws";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

const server = http.createServer(app);

// ✅ WebSocket en /ws
const wss = new WebSocketServer({ server, path: "/ws" });

// roomId -> Set<ws>
const rooms = new Map();

function roomSet(roomId) {
  if (!rooms.has(roomId)) rooms.set(roomId, new Set());
  return rooms.get(roomId);
}

function safeSend(ws, obj) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify(obj));
}

function broadcast(roomId, exceptWs, obj) {
  const set = rooms.get(roomId);
  if (!set) return;
  const data = JSON.stringify(obj);
  for (const client of set) {
    if (client === exceptWs) continue;
    if (client.readyState === 1) client.send(data);
  }
}

wss.on("connection", (ws, req) => {
  ws.roomId = null;
  ws.userId = null;

  safeSend(ws, { type: "HELLO", ts: Date.now() });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // JOIN
    if (msg.type === "JOIN") {
      const roomId = String(msg.roomId || "").trim();
      const userId = String(msg.userId || "").trim();

      if (!roomId || !userId) {
        safeSend(ws, { type: "ERROR", message: "Missing roomId/userId" });
        return;
      }

      // si estaba en otra room, salir
      if (ws.roomId && rooms.has(ws.roomId)) {
        rooms.get(ws.roomId).delete(ws);
      }

      ws.roomId = roomId;
      ws.userId = userId;
      roomSet(roomId).add(ws);

      safeSend(ws, { type: "JOINED", roomId, userId });
      broadcast(roomId, ws, { type: "USER_JOINED", userId });

      return;
    }

    // Ignorar si no está unido
    if (!ws.roomId || !ws.userId) {
      safeSend(ws, { type: "ERROR", message: "Join first" });
      return;
    }

    // EVENT (play/pause/seek/sync)
    if (msg.type === "EVENT") {
      broadcast(ws.roomId, ws, {
        type: "EVENT",
        from: ws.userId,
        event: msg.event,
      });
      return;
    }

    // CHAT
    if (msg.type === "CHAT") {
      const text = String(msg.text || "")
        .trim()
        .slice(0, 300);
      if (!text) return;

      broadcast(ws.roomId, null, {
        type: "CHAT",
        from: ws.userId,
        text,
        ts: Date.now(),
      });
      return;
    }

    // PING
    if (msg.type === "PING") {
      safeSend(ws, { type: "PONG", ts: Date.now() });
      return;
    }
  });

  ws.on("close", () => {
    const roomId = ws.roomId;
    const userId = ws.userId;

    if (roomId && rooms.has(roomId)) {
      rooms.get(roomId).delete(ws);
      broadcast(roomId, ws, { type: "USER_LEFT", userId });

      if (rooms.get(roomId).size === 0) rooms.delete(roomId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log("HTTP listening on", PORT);
  console.log("WS listening on /ws");
});
