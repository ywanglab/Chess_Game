import { WebSocketServer } from "ws";

const rooms = new Map();
const wss = new WebSocketServer({ port: 8788 });

function state(room) {
  for (const player of room.players) {
    player.ws.send(JSON.stringify({
      type: "state",
      color: player.color,
      turn: room.turn,
      moves: room.moves,
      status: room.finished ? "finished" : room.players.length === 2 ? "playing" : "waiting",
      result: room.result,
      players: room.players.map(({ username, color }) => ({ username, color, rating: 1200 })),
    }));
  }
}

wss.on("connection", (ws, request) => {
  const url = new URL(request.url, "http://localhost");
  const code = (url.searchParams.get("room") || "").toUpperCase().slice(0, 6);
  const username = (url.searchParams.get("username") || "").trim().slice(0, 20);
  if (!/^[A-Z0-9]{6}$/.test(code) || !/^[\w -]{2,20}$/.test(username)) return ws.close(1008, "Invalid table or username");
  const room = rooms.get(code) || { players: [], turn: "white", moves: [], finished: false, result: null };
  if (room.players.length >= 2) return ws.close(1008, "Table is full");
  const player = { ws, username, color: room.players.length ? "black" : "white" };
  room.players.push(player);
  rooms.set(code, room);
  state(room);

  ws.on("message", raw => {
    try {
      const message = JSON.parse(raw.toString());
      if (message.type === "move" && !room.finished && room.players.length === 2 && player.color === room.turn) {
        room.moves.push({ from: message.from, to: message.to });
        room.turn = room.turn === "white" ? "black" : "white";
        const event = JSON.stringify({ type: "move", from: message.from, to: message.to, turn: room.turn });
        room.players.forEach(item => item.ws.send(event));
      }
      if (message.type === "resign" && !room.finished) {
        room.finished = true;
        const winner = room.players.find(item => item !== player);
        if (winner) room.result = { winner: winner.username, loser: player.username, winnerColor: winner.color, reason: "resignation" };
        state(room);
      }
    } catch { /* Ignore malformed client messages. */ }
  });

  ws.on("close", () => {
    room.players = room.players.filter(item => item !== player);
    if (!room.players.length) rooms.delete(code);
    else room.players.forEach(item => item.ws.send(JSON.stringify({ type: "notice", message: "Opponent disconnected" })));
  });
});

console.log("Local chess WebSocket ready at ws://localhost:8788");
