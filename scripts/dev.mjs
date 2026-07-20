import { spawn } from "node:child_process";

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const socket = spawn(process.execPath, ["scripts/local-websocket.mjs"], { stdio: "inherit" });
const site = spawn(command, ["vinext", "dev"], { stdio: "inherit", shell: process.platform === "win32" });

function stop() {
  socket.kill();
  site.kill();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
site.on("exit", code => { socket.kill(); process.exit(code ?? 0); });
