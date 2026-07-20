import WebSocket from "ws";

const target = process.argv[2];
const ws = new WebSocket(target);
ws.on("open", () => { console.log("OPEN"); ws.close(); });
ws.on("unexpected-response", (_request, response) => {
  console.log("STATUS", response.statusCode);
  console.log("HEADERS", response.headers);
  response.on("data", chunk => process.stdout.write(chunk));
});
ws.on("error", error => console.error("ERROR", error.message));
setTimeout(() => ws.terminate(), 5000);
