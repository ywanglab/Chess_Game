/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface Fetcher { fetch(request: Request): Promise<Response> }
interface D1Result { results?: Record<string, unknown>[] }
interface D1Prepared { bind(...values: unknown[]): D1Prepared; run(): Promise<unknown>; first<T = Record<string, unknown>>(): Promise<T | null>; all(): Promise<D1Result> }
interface D1Database { prepare(sql: string): D1Prepared; batch(statements: D1Prepared[]): Promise<unknown> }
declare class WebSocketPair { 0: WebSocket; 1: WebSocket & { accept(): void } }

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

type Client = { ws: WebSocket; username: string; color: "white" | "black" };
type GameResult = { winner: string; loser: string; winnerColor: "white" | "black"; reason: "resignation" };
type Room = { clients: Client[]; turn: "white" | "black"; moves: {from:number;to:number}[]; finished: boolean; result: GameResult | null };
const rooms = new Map<string, Room>();

async function ensureDb(env: Env) {
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS players (username TEXT PRIMARY KEY, rating INTEGER NOT NULL DEFAULT 1200, wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0, draws INTEGER NOT NULL DEFAULT 0, games INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, room TEXT NOT NULL, white TEXT NOT NULL, black TEXT NOT NULL, result TEXT NOT NULL, moves TEXT NOT NULL, finished_at INTEGER NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS live_rooms (room TEXT PRIMARY KEY, white TEXT NOT NULL, white_id TEXT, black TEXT, black_id TEXT, turn TEXT NOT NULL DEFAULT 'white', moves TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'waiting', updated_at INTEGER NOT NULL)"),
  ]);
}

async function roomState(env: Env, code: string, clientId: string) {
  const room = await env.DB.prepare("SELECT room,white,white_id,black,black_id,turn,moves,status FROM live_rooms WHERE room=?").bind(code).first<{room:string;white:string;white_id:string|null;black:string|null;black_id:string|null;turn:"white"|"black";moves:string;status:string}>();
  if (!room || (clientId !== room.white_id && clientId !== room.black_id)) return null;
  const names = [room.white, room.black].filter(Boolean) as string[];
  const profiles = await Promise.all(names.map(name => env.DB.prepare("SELECT username,rating FROM players WHERE username=?").bind(name).first<{username:string;rating:number}>()));
  const players = profiles.filter(Boolean).map((profile,index)=>({...profile,color:index===0?"white":"black"}));
  const winnerColor=room.status.startsWith("finished:")?room.status.slice(9) as "white"|"black":null;
  const winner=winnerColor?players.find(item=>item.color===winnerColor):null;
  const loser=winnerColor?players.find(item=>item.color!==winnerColor):null;
  const result=winner&&loser?{winner:winner.username,loser:loser.username,winnerColor,reason:"resignation" as const}:null;
  return { type:"state", color: clientId === room.white_id ? "white" : "black", turn:room.turn, moves:JSON.parse(room.moves) as {from:number;to:number}[], status:winnerColor?"finished":room.status, result, players };
}

async function roomApi(request: Request, env: Env) {
  await ensureDb(env);
  const url = new URL(request.url);
  const body = request.method === "POST" ? await request.json() as Record<string, unknown> : {};
  const code = String(body.room || url.searchParams.get("room") || "").toUpperCase().slice(0,6);
  const username = String(body.username || url.searchParams.get("username") || "").trim().slice(0,20);
  const clientId = String(body.clientId || url.searchParams.get("clientId") || "").slice(0,64);
  if (!/^[A-Z0-9]{6}$/.test(code) || !/^[\w -]{2,20}$/.test(username) || !/^[a-zA-Z0-9-]{8,64}$/.test(clientId)) return Response.json({error:"Invalid table or player"},{status:400});
  if (request.method === "GET") {
    const state = await roomState(env,code,clientId);
    return state ? Response.json(state) : Response.json({error:"Table not found"},{status:404});
  }
  const action = String(body.action || "join");
  if (action === "join") {
    await player(env,username);
    await env.DB.prepare("INSERT OR IGNORE INTO live_rooms (room,white,white_id,updated_at) VALUES (?,?,?,?)").bind(code,username,clientId,Date.now()).run();
    let state = await roomState(env,code,clientId);
    if (!state) {
      await env.DB.prepare("UPDATE live_rooms SET black=?,black_id=?,status='playing',updated_at=? WHERE room=? AND black_id IS NULL AND white_id<>?").bind(username,clientId,Date.now(),code,clientId).run();
      state = await roomState(env,code,clientId);
    }
    return state ? Response.json(state) : Response.json({error:"Table is full"},{status:409});
  }
  const current = await roomState(env,code,clientId);
  if (!current) return Response.json({error:"Table not found"},{status:404});
  if (action === "move") {
    if (current.status === "finished" || current.color !== current.turn) return Response.json({error:"Move rejected"},{status:409});
    const from=Number(body.from),to=Number(body.to);
    if(!Number.isInteger(from)||!Number.isInteger(to)||from<0||from>63||to<0||to>63) return Response.json({error:"Invalid move"},{status:400});
    const moves=[...current.moves,{from,to}], next=current.turn==="white"?"black":"white";
    await env.DB.prepare("UPDATE live_rooms SET moves=?,turn=?,updated_at=? WHERE room=? AND turn=?").bind(JSON.stringify(moves),next,Date.now(),code,current.turn).run();
  } else if (action === "resign") {
    if (current.players.length < 2) return Response.json({error:"Wait for an opponent before resigning"},{status:409});
    if (current.status === "finished") return Response.json(current);
    const winnerColor=current.color==="white"?"black":"white";
    const winner=current.players.find(item=>item.color===winnerColor);
    const loser=current.players.find(item=>item.color===current.color);
    if (!winner || !loser) return Response.json({error:"Both players must be present"},{status:409});
    const claim=await env.DB.prepare("UPDATE live_rooms SET status=?,updated_at=? WHERE room=? AND status NOT LIKE 'finished:%'").bind(`finished:${winnerColor}`,Date.now(),code).run() as {meta?:{changes?:number}};
    if ((claim.meta?.changes ?? 0) > 0) {
      const white=current.players.find(item=>item.color==="white")!;
      const black=current.players.find(item=>item.color==="black")!;
      await env.DB.batch([
        env.DB.prepare("UPDATE players SET rating=rating+16,wins=wins+1,games=games+1,updated_at=? WHERE username=?").bind(Date.now(),winner.username),
        env.DB.prepare("UPDATE players SET rating=MAX(100,rating-16),losses=losses+1,games=games+1,updated_at=? WHERE username=?").bind(Date.now(),loser.username),
        env.DB.prepare("INSERT INTO games (id,room,white,black,result,moves,finished_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),code,white.username,black.username,winnerColor,JSON.stringify(current.moves),Date.now()),
      ]);
    }
  }
  return Response.json(await roomState(env,code,clientId));
}

async function player(env: Env, username: string) {
  await ensureDb(env);
  await env.DB.prepare("INSERT OR IGNORE INTO players (username, updated_at) VALUES (?, ?)").bind(username, Date.now()).run();
  return env.DB.prepare("SELECT username, rating, wins, losses, draws, games FROM players WHERE username = ?").bind(username).first();
}

async function finish(env: Env, code: string, room: Room, winner: Client | undefined) {
  if (room.finished || room.clients.length < 2) return;
  room.finished = true;
  const white = room.clients.find(client => client.color === "white")!;
  const black = room.clients.find(client => client.color === "black")!;
  const loser = winner === white ? black : white;
  if (winner && loser) await env.DB.batch([
    env.DB.prepare("UPDATE players SET rating=rating+16,wins=wins+1,games=games+1,updated_at=? WHERE username=?").bind(Date.now(),winner.username),
    env.DB.prepare("UPDATE players SET rating=MAX(100, rating-16),losses=losses+1,games=games+1,updated_at=? WHERE username=?").bind(Date.now(),loser.username),
    env.DB.prepare("INSERT INTO games (id,room,white,black,result,moves,finished_at) VALUES (?,?,?,?,?,?,?)").bind(crypto.randomUUID(),code,white.username,black.username,winner.color,JSON.stringify(room.moves),Date.now()),
  ]);
  room.result=winner&&loser?{winner:winner.username,loser:loser.username,winnerColor:winner.color,reason:"resignation"}:null;
  for (const c of room.clients) c.ws.send(JSON.stringify({type:"state",color:c.color,turn:room.turn,moves:room.moves,status:"finished",result:room.result,players:room.clients.map(x=>({username:x.username,rating:1200,color:x.color}))}));
}

async function socket(request: Request, env: Env) {
  if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", {status:426});
  const url = new URL(request.url), code=(url.searchParams.get("room")||"").toUpperCase().slice(0,6), username=(url.searchParams.get("username")||"").trim().slice(0,20);
  if (!/^[A-Z0-9]{6}$/.test(code) || !/^[\w -]{2,20}$/.test(username)) return new Response("Invalid room or username",{status:400});
  const room=rooms.get(code)||{clients:[],turn:"white" as const,moves:[],finished:false,result:null};
  if(room.clients.length>=2) return new Response("Table is full",{status:409});
  const pair=new WebSocketPair(), client=pair[0], server=pair[1]; server.accept();
  const profile=await player(env,username), entry:Client={ws:server,username,color:room.clients.length===0?"white":"black"}; room.clients.push(entry); rooms.set(code,room);
  const broadcastState=()=>room.clients.forEach(c=>c.ws.send(JSON.stringify({type:"state",color:c.color,turn:room.turn,moves:room.moves,status:room.finished?"finished":room.clients.length===2?"playing":"waiting",result:room.result,players:room.clients.map(x=>({username:x.username,rating:x.username===username?(profile?.rating||1200):1200,color:x.color}))})));
  broadcastState();
  server.addEventListener("message", async (event: MessageEvent)=>{ try { const msg=JSON.parse(String(event.data)); if(msg.type==="move"&&!room.finished&&room.clients.length===2&&entry.color===room.turn&&Number.isInteger(msg.from)&&Number.isInteger(msg.to)){room.moves.push({from:msg.from,to:msg.to});room.turn=room.turn==="white"?"black":"white";room.clients.forEach(c=>c.ws.send(JSON.stringify({type:"move",from:msg.from,to:msg.to,turn:room.turn})));} if(msg.type==="resign") await finish(env,code,room,room.clients.find(c=>c!==entry)); } catch {} });
  server.addEventListener("close",()=>{room.clients=room.clients.filter(c=>c!==entry);if(!room.clients.length)rooms.delete(code);else room.clients.forEach(c=>c.ws.send(JSON.stringify({type:"notice",message:"Opponent disconnected"})));});
  return new Response(null,{status:101,webSocket:client} as ResponseInit);
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/socket") return socket(request, env);
    if (url.pathname === "/api/room") return roomApi(request, env);
    if (url.pathname === "/api/leaderboard") {
      await ensureDb(env);
      const rows = await env.DB.prepare("SELECT username,rating,wins FROM players ORDER BY rating DESC,wins DESC LIMIT 10").all();
      return Response.json(rows.results);
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
