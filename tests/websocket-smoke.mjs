const base = process.argv[2] || "ws://localhost:3000";
const room = `T${Math.random().toString(36).slice(2, 7)}`.toUpperCase();
const events = [];

function open(username) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${base}/api/socket?room=${room}&username=${username}`);
    ws.addEventListener("open", () => resolve(ws));
    ws.addEventListener("error", reject);
    ws.addEventListener("message", event => events.push({ username, data: JSON.parse(event.data) }));
  });
}

const white = await open("white-test");
const black = await open("black-test");
await new Promise(resolve => setTimeout(resolve, 250));
white.send(JSON.stringify({ type: "move", from: 52, to: 36 }));
await new Promise(resolve => setTimeout(resolve, 250));
console.log(JSON.stringify(events, null, 2));
white.close();
black.close();

if (!events.some(event => event.data.type === "move" && event.data.from === 52 && event.data.to === 36)) {
  throw new Error("First move was not broadcast");
}
