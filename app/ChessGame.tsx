"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Color = "white" | "black";
type Piece = { type: string; color: Color } | null;
type Player = { username: string; rating: number; color: Color };
type Move = { from: number; to: number };
type GameResult = { winner: string; loser: string; winnerColor: Color; reason: "resignation" };
type Wire = { type: string; [key: string]: unknown };

const glyph: Record<string, string> = {
  whitek: "♔", whiteq: "♕", whiter: "♖", whiteb: "♗", whiten: "♘", whitep: "♙",
  blackk: "♚", blackq: "♛", blackr: "♜", blackb: "♝", blackn: "♞", blackp: "♟",
};

function initialBoard(): Piece[] {
  const back = ["r", "n", "b", "q", "k", "b", "n", "r"];
  return Array.from({ length: 64 }, (_, i) => {
    const row = Math.floor(i / 8), col = i % 8;
    if (row === 0) return { type: back[col], color: "black" };
    if (row === 1) return { type: "p", color: "black" };
    if (row === 6) return { type: "p", color: "white" };
    if (row === 7) return { type: back[col], color: "white" };
    return null;
  });
}

const pieceNames: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
function squareName(index: number) { return `${"abcdefgh"[index % 8]}${8 - Math.floor(index / 8)}`; }
function selectedStatus(piece: NonNullable<Piece>, index: number) {
  return `${piece.color === "white" ? "White" : "Black"} ${pieceNames[piece.type]} selected on ${squareName(index)} · choose a highlighted square`;
}

function targets(board: Piece[], from: number): number[] {
  const p = board[from]; if (!p) return [];
  const r = Math.floor(from / 8), c = from % 8, out: number[] = [];
  const add = (rr: number, cc: number) => {
    if (rr < 0 || rr > 7 || cc < 0 || cc > 7) return false;
    const at = rr * 8 + cc;
    if (!board[at]) { out.push(at); return true; }
    if (board[at]?.color !== p.color) out.push(at);
    return false;
  };
  if (p.type === "p") {
    const d = p.color === "white" ? -1 : 1, start = p.color === "white" ? 6 : 1;
    if (!board[(r + d) * 8 + c]) {
      out.push((r + d) * 8 + c);
      if (r === start && !board[(r + 2 * d) * 8 + c]) out.push((r + 2 * d) * 8 + c);
    }
    for (const dc of [-1, 1]) { const rr = r + d, cc = c + dc; if (rr >= 0 && rr < 8 && cc >= 0 && cc < 8 && board[rr * 8 + cc]?.color !== p.color && board[rr * 8 + cc]) out.push(rr * 8 + cc); }
  } else if (p.type === "n") {
    for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) add(r+dr,c+dc);
  } else if (p.type === "k") {
    for (let dr=-1;dr<=1;dr++) for(let dc=-1;dc<=1;dc++) if(dr||dc) add(r+dr,c+dc);
  } else {
    const dirs = p.type === "b" ? [[-1,-1],[-1,1],[1,-1],[1,1]] : p.type === "r" ? [[-1,0],[1,0],[0,-1],[0,1]] : [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]];
    for (const [dr,dc] of dirs) for(let n=1;n<8;n++) if(!add(r+dr*n,c+dc*n)) break;
  }
  return out;
}

export default function ChessGame() {
  const [username, setUsername] = useState("");
  const [roomInput, setRoomInput] = useState("");
  const [room, setRoom] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [board, setBoard] = useState<Piece[]>(initialBoard);
  const [turn, setTurn] = useState<Color>("white");
  const [me, setMe] = useState<Color | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [status, setStatus] = useState("Choose a name to get started");
  const [history, setHistory] = useState<Move[]>([]);
  const [result, setResult] = useState<GameResult | null>(null);
  const [theme, setTheme] = useState<"light"|"dark">("light");
  const [boardColor, setBoardColor] = useState<"forest"|"classic"|"midnight">("forest");
  const [leaderboard, setLeaderboard] = useState<{username:string;rating:number;wins:number}[]>([]);
  const socket = useRef<WebSocket | null>(null);
  const poller = useRef<ReturnType<typeof setInterval> | null>(null);
  const dragFrom = useRef<number | null>(null);
  const clientId = useRef(typeof crypto !== "undefined" ? crypto.randomUUID() : Math.random().toString(36).slice(2));
  const confirmedMoveCount = useRef(0);
  const pendingMove = useRef<{from:number;to:number;base:number}|null>(null);
  const selectedRef = useRef<number | null>(null);
  const usingHostedConnection = useRef(false);
  const legal = useMemo(() => selected === null ? [] : targets(board, selected), [board, selected]);

  useEffect(() => { fetch("/api/leaderboard").then(r=>r.json()).then(setLeaderboard).catch(()=>{}); }, []);
  useEffect(()=>{const savedTheme=localStorage.getItem("castle-theme");const savedBoard=localStorage.getItem("castle-board");if(savedTheme==="dark")setTheme("dark");if(savedBoard==="classic"||savedBoard==="midnight")setBoardColor(savedBoard);},[]);
  useEffect(() => () => { socket.current?.close(); if(poller.current) clearInterval(poller.current); }, []);

  function selectSquare(index: number | null) { selectedRef.current=index; setSelected(index); }

  function receiveState(msg: Wire) {
    const nextPlayers = msg.players as Player[];
    setPlayers(nextPlayers); setMe(msg.color as Color);
    let renderedBoard=board;
    if (Array.isArray(msg.moves)) {
      const serverMoves=msg.moves as Move[];
      if(serverMoves.length<confirmedMoveCount.current) return;
      const pending=pendingMove.current;
      if(pending&&serverMoves.length>pending.base&&serverMoves[pending.base]?.from===pending.from&&serverMoves[pending.base]?.to===pending.to) pendingMove.current=null;
      confirmedMoveCount.current=serverMoves.length;
      const renderedMoves=pendingMove.current?[...serverMoves,{from:pendingMove.current.from,to:pendingMove.current.to}]:serverMoves;
      const next=initialBoard();
      for(const move of renderedMoves) { const p=next[move.from]; next[move.from]=null; next[move.to]=p && (p.type==="p"&&[0,7].includes(Math.floor(move.to/8)))?{...p,type:"q"}:p; }
      renderedBoard=next; setBoard(next); setHistory(renderedMoves);
    }
    const nextResult=(msg.result as GameResult|null)||null;
    setResult(nextResult);
    const displayedTurn=pendingMove.current?(msg.color==="white"?"black":"white"):(msg.turn as Color)||"white";
    setTurn(displayedTurn);
    const selectedIndex=selectedRef.current, selectedPiece=selectedIndex===null?null:renderedBoard[selectedIndex];
    setStatus(nextResult?`${nextResult.winner} wins · ${nextResult.loser} loses by resignation`:pendingMove.current?"Move sent · waiting for sync":selectedPiece?selectedStatus(selectedPiece,selectedIndex as number):nextPlayers.length === 2 ? `${displayedTurn === msg.color ? "Your turn" : "Opponent’s turn"} · ${displayedTurn.toUpperCase()} to move` : "Waiting for an opponent…");
  }

  async function connectHosted(code:string) {
    usingHostedConnection.current=true;
    const payload={action:"join",room:code,username:username.trim(),clientId:clientId.current};
    const response=await fetch("/api/room",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)});
    const data=await response.json() as Wire;
    if(!response.ok) { setStatus(String(data.error||"Couldn’t join this table")); return; }
    receiveState(data);
    if(poller.current) clearInterval(poller.current);
    poller.current=setInterval(async()=>{ try { const r=await fetch(`/api/room?room=${encodeURIComponent(code)}&username=${encodeURIComponent(username.trim())}&clientId=${encodeURIComponent(clientId.current)}`,{cache:"no-store"}); if(r.ok) receiveState(await r.json() as Wire); } catch {} },500);
  }

  function connect(code: string, expectedColor: Color) {
    if (!username.trim()) { setStatus("Enter a username first"); return; }
    const normalizedCode = code.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(normalizedCode)) { setStatus("Enter the complete 6-character table code"); return; }
    socket.current?.close();
    usingHostedConnection.current=false;
    pendingMove.current=null; confirmedMoveCount.current=0; setBoard(initialBoard()); setTurn("white"); setPlayers([{username:username.trim(),rating:1200,color:expectedColor}]); setMe(expectedColor); selectSquare(null); setHistory([]); setResult(null);
    setRoom(normalizedCode);
    setStatus("Connecting to the table…");
    const local = ["localhost", "127.0.0.1"].includes(location.hostname);
    if(!local) { void connectHosted(normalizedCode); return; }
    const socketOrigin = local ? "ws://localhost:8788" : `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}`;
    const ws = new WebSocket(`${socketOrigin}/api/socket?room=${encodeURIComponent(normalizedCode)}&username=${encodeURIComponent(username.trim())}`);
    socket.current = ws;
    let receivedState=false, fallbackStarted=false;
    const usePollingFallback=()=>{if(receivedState||fallbackStarted)return;fallbackStarted=true;socket.current=null;setStatus("Live connection unavailable · switching connection mode…");void connectHosted(normalizedCode);};
    ws.onopen = () => setStatus("Waiting for an opponent…");
    ws.onmessage = e => {
      const msg = JSON.parse(e.data) as Wire;
      if (msg.type === "state") {
        receivedState=true;
        receiveState(msg);
      }
      if (msg.type === "move") {
        const pending=pendingMove.current;
        const wasMine=Boolean(pending&&pending.from===msg.from&&pending.to===msg.to);
        if(wasMine) { pendingMove.current=null; confirmedMoveCount.current+=1; }
        else { setBoard(b => { const n=[...b], p=n[msg.from as number]; n[msg.from as number]=null; n[msg.to as number]=p && (p.type==="p" && [0,7].includes(Math.floor((msg.to as number)/8))) ? {...p,type:"q"}:p; return n; }); setHistory(items=>[...items,{from:msg.from as number,to:msg.to as number}]); }
        setTurn(msg.turn as Color); selectSquare(null); setStatus(`${wasMine?"Opponent’s turn":"Your turn"} · ${String(msg.turn).toUpperCase()} to move`);
      }
      if (msg.type === "notice") setStatus(msg.message as string);
      if (msg.type === "reset") { setBoard(initialBoard()); setTurn("white"); }
    };
    ws.onerror = usePollingFallback;
    ws.onclose = () => { if(receivedState)setStatus("Table disconnected"); else usePollingFallback(); };
  }
  function createRoom() { connect(Math.random().toString(36).slice(2,8).toUpperCase(),"white"); }
  async function submitMove(from:number,to:number) {
    const moving=board[from];
    if (["localhost", "127.0.0.1"].includes(location.hostname) && !usingHostedConnection.current && socket.current?.readyState !== WebSocket.OPEN) {
      setStatus("The live connection is not ready. Please wait a moment and try again.");
      return;
    }
    pendingMove.current={from,to,base:confirmedMoveCount.current};
    setBoard(current=>{const next=[...current],piece=next[from];next[from]=null;next[to]=piece&&piece.type==="p"&&[0,7].includes(Math.floor(to/8))?{...piece,type:"q"}:piece;return next;});
    setHistory(items=>[...items,{from,to}]); selectSquare(null); setTurn(me === "white" ? "black" : "white"); setStatus("Move sent…");
    if(["localhost","127.0.0.1"].includes(location.hostname)&&!usingHostedConnection.current) { socket.current?.send(JSON.stringify({type:"move",from,to})); return; }
    try {
      const response=await fetch("/api/room",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"move",room,username:username.trim(),clientId:clientId.current,from,to})});
      const data=await response.json() as Wire;
      if(!response.ok) { pendingMove.current=null; setBoard(current=>{const next=[...current];next[from]=moving;next[to]=board[to];return next;}); setHistory(items=>items.slice(0,-1)); setTurn(me||"white"); setStatus(String(data.error||"That move was rejected")); return; }
      receiveState(data);
    } catch { setStatus("The move could not reach the table. Please try again."); }
  }
  function clickSquare(i:number) {
    if (!me) { setStatus("The live connection is not ready yet"); return; }
    if (result) { setStatus(`${result.winner} wins · ${result.loser} loses by resignation`); return; }
    if (turn !== me) { setStatus("It’s your opponent’s turn"); return; }
    if (selected !== null && legal.includes(i)) {
      void submitMove(selected,i);
      return;
    }
    if(board[i]?.color === me) { selectSquare(i); setStatus(selectedStatus(board[i] as NonNullable<Piece>,i)); }
    else selectSquare(null);
  }
  function dropPiece(to:number) {
    const from=dragFrom.current; dragFrom.current=null;
    if(from!==null&&turn===me&&targets(board,from).includes(to)) void submitMove(from,to);
    else setStatus("That piece can’t move there");
  }
  async function resign() { if(result||!confirm("Resign this game?")) return; if(["localhost","127.0.0.1"].includes(location.hostname)&&!usingHostedConnection.current) socket.current?.send(JSON.stringify({type:"resign"})); else { const response=await fetch("/api/room",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"resign",room,username:username.trim(),clientId:clientId.current})}); const data=await response.json() as Wire; if(response.ok) receiveState(data); else setStatus(String(data.error||"Could not resign the game")); } }

  function chooseTheme(next:"light"|"dark") { setTheme(next); localStorage.setItem("castle-theme",next); }
  function chooseBoard(next:"forest"|"classic"|"midnight") { setBoardColor(next); localStorage.setItem("castle-board",next); }
  const whitePlayer=players.find(player=>player.color==="white");
  const blackPlayer=players.find(player=>player.color==="black");
  const recentMoves=history.slice(-5), recentStart=history.length-recentMoves.length;

  return <main data-theme={theme} data-board={boardColor}>
    <style>{`main{min-height:100vh;background:var(--cream);color:var(--ink);transition:background .2s,color .2s}main[data-theme="dark"]{--ink:#edf2ea;--cream:#101712;--paper:#172019;--green:#294b37;--line:#3b493f}main[data-theme="dark"] .dek,main[data-theme="dark"] .panel p,main[data-theme="dark"] .playerline small,main[data-theme="dark"] .history-panel small{color:#aebbb1}main[data-theme="dark"] .join input,main[data-theme="dark"] .start-card input{background:#f5f3ec;color:#122218}main[data-board="forest"] .board .light{background:#e5dfcf}main[data-board="forest"] .board .dark{background:#55735f}main[data-board="classic"] .board .light{background:#f0d9b5}main[data-board="classic"] .board .dark{background:#b58863}main[data-board="midnight"] .board .light{background:#cad5e2}main[data-board="midnight"] .board .dark{background:#36516f}.result-card{margin-top:16px;padding:14px;background:var(--green);color:white;display:grid;gap:5px}.result-card small{color:var(--lime);font-size:9px;font-weight:900;letter-spacing:2px}.result-card strong{font:700 20px Georgia}.result-card span{font:13px Georgia;color:#dbe5de}.history-panel{border:1px solid var(--line);border-top:0;padding:20px}.history-head{display:flex;align-items:baseline;justify-content:space-between}.history-head h3{font:700 18px Georgia;margin:0}.history-head small,.history-foot{font-size:9px;letter-spacing:1px;color:#6d786f}.history-panel ol{list-style:none;padding:0;margin:14px 0 8px}.history-panel li{display:grid;grid-template-columns:34px 46px 1fr;gap:7px;padding:8px 0;border-top:1px solid var(--line);font-size:11px;align-items:center}.history-panel li span{color:#6d786f}.history-panel li b{font-size:9px;text-transform:uppercase}.history-panel code{text-align:right;font:700 12px Georgia}.history-empty{color:#6d786f;font:italic 13px Georgia}.appearance{border:1px solid var(--line);border-top:0;padding:20px}.appearance>small{font-size:9px;font-weight:900;letter-spacing:2px}.choice-row{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin:13px 0}.choice-row button{border:1px solid var(--line);background:transparent;color:var(--ink);padding:9px;font-size:11px;font-weight:800}.choice-row button.active{background:var(--ink);color:var(--cream)}.swatches{display:flex;gap:10px}.swatches button{width:32px;height:32px;border:3px solid transparent;border-radius:50%;box-shadow:inset 0 0 0 15px var(--swatch-dark);background:linear-gradient(135deg,var(--swatch-light) 50%,var(--swatch-dark) 50%)}.swatches button.active{border-color:var(--lime);box-shadow:0 0 0 1px var(--ink)}.swatches .forest{--swatch-light:#e5dfcf;--swatch-dark:#55735f}.swatches .classic{--swatch-light:#f0d9b5;--swatch-dark:#b58863}.swatches .midnight{--swatch-light:#cad5e2;--swatch-dark:#36516f}.resign:disabled{color:#788078;cursor:default;text-decoration:none}`}</style>
    <nav><a className="brand" href="#" aria-label="Castle chess home"><span className="brand-mark" aria-hidden="true">♜</span><span className="brand-copy"><strong>CASTLE</strong><small>CHESS CLUB</small></span></a><div className="live"><i/> LIVE MULTIPLAYER</div></nav>
    <section className="shell">
      <header><p className="eyebrow">A BETTER WAY TO PLAY</p><h1>Your move.</h1><p className="dek">No accounts. No clutter. Just share a table code and play a proper game of chess.</p></header>
      {!room ? <section className="lobby">
        <div className="start-card"><label>YOUR PLAYER NAME</label><input value={username} onChange={e=>setUsername(e.target.value)} placeholder="e.g. knightowl" maxLength={20}/><button onClick={createRoom}>Create a table <b>→</b></button></div>
        <div className="or"><span/>OR JOIN A FRIEND<span/></div>
        <div className="join"><input value={roomInput} onChange={e=>setRoomInput(e.target.value.toUpperCase())} placeholder="TABLE CODE" maxLength={6}/><button onClick={()=>connect(roomInput,"black")}>Join table</button></div>
        <p className="status">{status}</p>
      </section> : <section className="game-layout">
        <div className="board-wrap">
          <div className="playerline"><div className={`avatar ${me==="black"?"mine":""}`}>{blackPlayer?.username?.[0]?.toUpperCase()||"?"}</div><div><strong>{blackPlayer?.username||"Waiting…"} {me==="black"&&<em>YOU · BLACK</em>}</strong><small>{blackPlayer?.rating||1200}</small></div>{turn==="black"&&<span className="turn">{me==="black"?"YOUR TURN":"THINKING"}</span>}</div>
          <div className="board" role="grid" aria-label="Chess board">{board.map((p,i)=><button aria-label={`square ${i}`} key={i} draggable={Boolean(p&&p.color===me&&turn===me&&!result)} onDragStart={()=>{dragFrom.current=i;selectSquare(i);if(p)setStatus(selectedStatus(p,i));}} onDragOver={e=>e.preventDefault()} onDrop={()=>dropPiece(i)} onClick={()=>clickSquare(i)} className={`${(Math.floor(i/8)+i)%2?"dark":"light"} ${selected===i?"selected":""} ${legal.includes(i)?"target":""}`}><span>{p?glyph[p.color+p.type]:""}</span></button>)}</div>
          <div className="playerline"><div className={`avatar ${me==="white"?"mine":""}`}>{whitePlayer?.username?.[0]?.toUpperCase()||"?"}</div><div><strong>{whitePlayer?.username||"Waiting…"} {me==="white"&&<em>YOU · WHITE</em>}</strong><small>{whitePlayer?.rating||1200}</small></div>{turn==="white"&&<span className="turn">{me==="white"?"YOUR TURN":"THINKING"}</span>}</div>
        </div>
        <aside><div className="code"><small>TABLE CODE</small><strong>{room}</strong><button onClick={()=>navigator.clipboard.writeText(room)}>COPY</button></div><div className="panel"><h3>Game status</h3><p>{status}</p>{result?<div className="result-card"><small>GAME OVER</small><strong>{result.winner} wins</strong><span>{result.loser} loses by resignation</span></div>:<p>{turn === me ? "Take your time. Your clock isn't running in the MVP." : "Your opponent is on the move."}</p>}</div><div className="history-panel"><div className="history-head"><h3>Move history</h3><small>{history.length} TOTAL</small></div>{recentMoves.length?<ol>{recentMoves.map((move,index)=>{const absolute=recentStart+index;return <li key={`${absolute}-${move.from}-${move.to}`}><span>{Math.floor(absolute/2)+1}{absolute%2===0?".":"…"}</span><b>{absolute%2===0?"White":"Black"}</b><code>{squareName(move.from)} → {squareName(move.to)}</code></li>;})}</ol>:<p className="history-empty">No moves yet.</p>}<small className="history-foot">Showing the latest 5 · full history saved</small></div><div className="appearance"><small>APPEARANCE</small><div className="choice-row" aria-label="Page theme"><button className={theme==="light"?"active":""} onClick={()=>chooseTheme("light")}>☀ Light</button><button className={theme==="dark"?"active":""} onClick={()=>chooseTheme("dark")}>◐ Dark</button></div><div className="swatches" aria-label="Board colors"><button aria-label="Forest board" className={`forest ${boardColor==="forest"?"active":""}`} onClick={()=>chooseBoard("forest")}/><button aria-label="Classic board" className={`classic ${boardColor==="classic"?"active":""}`} onClick={()=>chooseBoard("classic")}/><button aria-label="Midnight board" className={`midnight ${boardColor==="midnight"?"active":""}`} onClick={()=>chooseBoard("midnight")}/></div></div><button className="resign" onClick={resign} disabled={Boolean(result)}>{result?"Game finished":"Resign game"}</button></aside>
      </section>}
      <section className="leaders"><div><p className="eyebrow">THE CLUB</p><h2>Top players</h2></div><ol>{leaderboard.length?leaderboard.slice(0,5).map((p,i)=><li key={p.username}><span>{String(i+1).padStart(2,"0")}</span><strong>{p.username}</strong><small>{p.wins} wins</small><b>{p.rating}</b></li>):<li className="empty">Finish the first game to start the leaderboard.</li>}</ol></section>
    </section><footer><span>CASTLE CHESS · MVP</span><span>Built for friendly rivalry.</span></footer>
  </main>;
}
