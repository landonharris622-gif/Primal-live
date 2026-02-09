const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const bcrypt = require("bcryptjs");

const { init, run, get, all, DB_PATH } = require("./db");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-secret-change-me";

fs.mkdirSync(path.join(__dirname, "uploads"), { recursive: true });
fs.mkdirSync(path.join(__dirname, "uploads", "thumbs"), { recursive: true });
fs.mkdirSync(path.join(__dirname, "uploads", "vods"), { recursive: true });
fs.mkdirSync(path.join(__dirname, "uploads", "tmp"), { recursive: true });

const upload = multer({ dest: path.join(__dirname, "uploads", "tmp") });

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  store: new SQLiteStore({ db: path.basename(DB_PATH), dir: __dirname }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax" }
}));

app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.static(path.join(__dirname, "public")));

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: "Not logged in" });
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    const u = req.session.user;
    if (!u) return res.status(401).json({ error: "Not logged in" });
    if (!roles.includes(u.role)) return res.status(403).json({ error: "Forbidden" });
    next();
  };
}
function staffBadge(role) {
  if (role === "ADMIN") return "ADMIN";
  if (role === "CREATOR") return "CREATOR";
  return "";
}

// -------- Auth --------
app.post("/api/auth/register", async (req, res) => {
  const { email, username, password } = req.body;
  if (!email || !username || !password) return res.status(400).json({ error: "Missing fields" });
  if (String(password).length < 6) return res.status(400).json({ error: "Password too short" });

  const id = uuidv4();
  const passwordHash = await bcrypt.hash(String(password), 10);
  try {
    await run(
      "INSERT INTO users (id,email,username,passwordHash,role,createdAt) VALUES (?,?,?,?,?,?)",
      [id, String(email).toLowerCase(), String(username), passwordHash, "VIEWER", Date.now()]
    );
    req.session.user = { id, email: String(email).toLowerCase(), username: String(username), role: "VIEWER" };
    res.json({ ok: true });
  } catch {
    res.status(400).json({ error: "Email or username already used" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Missing fields" });
  const u = await get("SELECT id,email,username,passwordHash,role FROM users WHERE email=?", [String(email).toLowerCase()]);
  if (!u) return res.status(400).json({ error: "Invalid credentials" });
  const ok = await bcrypt.compare(String(password), u.passwordHash);
  if (!ok) return res.status(400).json({ error: "Invalid credentials" });
  req.session.user = { id: u.id, email: u.email, username: u.username, role: u.role };
  res.json({ ok: true });
});

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", (req, res) => {
  res.json({ user: req.session.user || null });
});

// -------- Streams --------
app.get("/api/streams/live", async (req, res) => {
  const rows = await all(`
    SELECT s.*, u.username as creatorUsername
    FROM streams s JOIN users u ON u.id=s.creatorId
    WHERE s.isLive=1
    ORDER BY s.viewerCount DESC, s.startedAt DESC
  `);
  res.json({ streams: rows });
});

app.get("/api/streams/:id", async (req, res) => {
  const s = await get(`
    SELECT s.*, u.username as creatorUsername
    FROM streams s JOIN users u ON u.id=s.creatorId
    WHERE s.id=?
  `, [req.params.id]);
  if (!s) return res.status(404).json({ error: "Not found" });
  res.json({ stream: s });
});

app.post("/api/streams/create", requireRole("CREATOR","ADMIN"), async (req, res) => {
  const title = (req.body.title || "").trim() || "Untitled Stream";
  const id = uuidv4();
  await run(`INSERT INTO streams (id,creatorId,title,ingestType,isLive,viewerCount,createdAt)
             VALUES (?,?,?,?,?,?,?)`, [id, req.session.user.id, title, "WEBRTC", 0, 0, Date.now()]);
  res.json({ ok: true, id });
});

app.post("/api/streams/:id/thumbnail", requireRole("CREATOR","ADMIN"), upload.single("thumbnail"), async (req, res) => {
  const streamId = req.params.id;
  const s = await get("SELECT * FROM streams WHERE id=?", [streamId]);
  if (!s) return res.status(404).json({ error: "Stream not found" });
  if (req.session.user.role !== "ADMIN" && s.creatorId !== req.session.user.id) return res.status(403).json({ error: "Forbidden" });

  const file = req.file;
  if (!file) return res.status(400).json({ error: "No file" });
  const ext = path.extname(file.originalname).toLowerCase() || ".png";
  const dest = path.join(__dirname, "uploads", "thumbs", `${streamId}${ext}`);
  fs.renameSync(file.path, dest);
  const thumbPath = `/uploads/thumbs/${streamId}${ext}`;
  await run("UPDATE streams SET thumbnailPath=? WHERE id=?", [thumbPath, streamId]);
  res.json({ ok: true, thumbnailPath: thumbPath });
});

app.post("/api/streams/:id/start", requireRole("CREATOR","ADMIN"), async (req, res) => {
  const streamId = req.params.id;
  const s = await get("SELECT * FROM streams WHERE id=?", [streamId]);
  if (!s) return res.status(404).json({ error: "Stream not found" });
  if (req.session.user.role !== "ADMIN" && s.creatorId !== req.session.user.id) return res.status(403).json({ error: "Forbidden" });
  await run("UPDATE streams SET isLive=1, startedAt=?, endedAt=NULL, viewerCount=0 WHERE id=?", [Date.now(), streamId]);
  res.json({ ok: true });
});

function broadcastRoom(room, obj) {
  const set = socketsByRoom.get(room);
  if (!set) return;
  const msg = JSON.stringify(obj);
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

app.post("/api/streams/:id/end", requireRole("CREATOR","ADMIN"), async (req, res) => {
  const streamId = req.params.id;
  const s = await get("SELECT * FROM streams WHERE id=?", [streamId]);
  if (!s) return res.status(404).json({ error: "Stream not found" });
  if (req.session.user.role !== "ADMIN" && s.creatorId !== req.session.user.id) return res.status(403).json({ error: "Forbidden" });

  await run("UPDATE streams SET isLive=0, endedAt=?, viewerCount=0 WHERE id=?", [Date.now(), streamId]);
  await run("DELETE FROM viewer_sessions WHERE streamId=?", [streamId]);
  broadcastRoom(streamId, { type: "stream-ended", streamId });
  res.json({ ok: true });
});

app.post("/api/streams/:id/heartbeat", async (req, res) => {
  const streamId = req.params.id;
  const sessionId = req.body.sessionId;
  if (!sessionId) return res.status(400).json({ error: "Missing sessionId" });
  const s = await get("SELECT id FROM streams WHERE id=?", [streamId]);
  if (!s) return res.status(404).json({ error: "Stream not found" });

  const now = Date.now();
  const userId = req.session.user ? req.session.user.id : null;

  const existing = await get("SELECT id FROM viewer_sessions WHERE streamId=? AND sessionId=?", [streamId, sessionId]);
  if (existing) {
    await run("UPDATE viewer_sessions SET lastSeenAt=? WHERE id=?", [now, existing.id]);
  } else {
    await run("INSERT INTO viewer_sessions (id,streamId,sessionId,userId,lastSeenAt,createdAt) VALUES (?,?,?,?,?,?)",
      [uuidv4(), streamId, sessionId, userId, now, now]);
  }

  const cutoff = now - 75_000;
  await run("DELETE FROM viewer_sessions WHERE streamId=? AND lastSeenAt < ?", [streamId, cutoff]);

  const countRow = await get("SELECT COUNT(*) as c FROM viewer_sessions WHERE streamId=?", [streamId]);
  await run("UPDATE streams SET viewerCount=? WHERE id=?", [countRow.c, streamId]);
  res.json({ ok: true, viewerCount: countRow.c });
});

// -------- Chat --------
app.get("/api/chat/:streamId", async (req, res) => {
  const streamId = req.params.streamId;
  const msgs = await all(`
    SELECT m.id,m.streamId,m.userId,m.usernameSnapshot,m.message,m.createdAt,u.role
    FROM chat_messages m JOIN users u ON u.id=m.userId
    WHERE m.streamId=?
    ORDER BY m.createdAt ASC
    LIMIT 200
  `, [streamId]);
  res.json({ messages: msgs.map(m => ({...m, badge: staffBadge(m.role) })) });
});

app.post("/api/chat/:streamId/send", requireAuth, async (req, res) => {
  const streamId = req.params.streamId;
  const message = (req.body.message || "").trim();
  if (!message) return res.status(400).json({ error: "Empty" });
  if (message.length > 240) return res.status(400).json({ error: "Too long" });

  const s = await get("SELECT id,isLive FROM streams WHERE id=?", [streamId]);
  if (!s) return res.status(404).json({ error: "Stream not found" });
  if (!s.isLive) return res.status(400).json({ error: "Stream offline" });

  const u = req.session.user;
  const id = uuidv4();
  const createdAt = Date.now();

  await run("INSERT INTO chat_messages (id,streamId,userId,usernameSnapshot,message,createdAt) VALUES (?,?,?,?,?,?)",
    [id, streamId, u.id, u.username, message, createdAt]);

  broadcastRoom(streamId, { type:"chat", streamId, id, username:u.username, badge: staffBadge(u.role), message, createdAt });
  res.json({ ok: true });
});

// -------- Admin --------
app.get("/api/admin/users", requireRole("ADMIN"), async (req, res) => {
  const users = await all("SELECT id,email,username,role,createdAt FROM users ORDER BY createdAt DESC LIMIT 500");
  res.json({ users });
});
app.post("/api/admin/users/:id/role", requireRole("ADMIN"), async (req, res) => {
  const role = req.body.role;
  if (!["ADMIN","CREATOR","VIEWER"].includes(role)) return res.status(400).json({ error: "Invalid role" });
  await run("UPDATE users SET role=? WHERE id=?", [role, req.params.id]);
  res.json({ ok: true });
});
app.get("/api/admin/streams", requireRole("ADMIN"), async (req, res) => {
  const streams = await all(`
    SELECT s.*, u.username as creatorUsername
    FROM streams s JOIN users u ON u.id=s.creatorId
    ORDER BY s.createdAt DESC LIMIT 500
  `);
  res.json({ streams });
});
app.post("/api/admin/streams/:id/force-end", requireRole("ADMIN"), async (req, res) => {
  await run("UPDATE streams SET isLive=0, endedAt=?, viewerCount=0 WHERE id=?", [Date.now(), req.params.id]);
  await run("DELETE FROM viewer_sessions WHERE streamId=?", [req.params.id]);
  broadcastRoom(req.params.id, { type:"stream-ended", streamId:req.params.id });
  res.json({ ok: true });
});

// -------- VOD upload --------
app.get("/api/vods", async (req, res) => {
  const vods = await all(`
    SELECT v.id,v.streamId,v.creatorId,v.title,v.filePath,v.createdAt,u.username as creatorUsername
    FROM vods v JOIN users u ON u.id=v.creatorId
    ORDER BY v.createdAt DESC LIMIT 200
  `);
  res.json({ vods });
});
app.post("/api/vods/upload", requireRole("CREATOR","ADMIN"), upload.single("vod"), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: "No file" });

  const vodId = uuidv4();
  const dest = path.join(__dirname, "uploads", "vods", `${vodId}.webm`);
  fs.renameSync(file.path, dest);
  const urlPath = `/uploads/vods/${vodId}.webm`;

  const title = (req.body.title || "").trim() || "Untitled VOD";
  const streamId = req.body.streamId || null;

  await run("INSERT INTO vods (id,streamId,creatorId,title,filePath,createdAt) VALUES (?,?,?,?,?,?)",
    [vodId, streamId, req.session.user.id, title, urlPath, Date.now()]);

  res.json({ ok: true, vodId, url: urlPath });
});

// -------- Optional Mux (OBS/RTMP) --------
async function muxCreateLiveStream(title) {
  const tokenId = process.env.MUX_TOKEN_ID;
  const tokenSecret = process.env.MUX_TOKEN_SECRET;
  if (!tokenId || !tokenSecret) throw new Error("Mux env vars missing");

  const auth = Buffer.from(`${tokenId}:${tokenSecret}`).toString("base64");
  const resp = await fetch("https://api.mux.com/video/v1/live-streams", {
    method: "POST",
    headers: { "Authorization": `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      playback_policy: ["public"],
      new_asset_settings: { playback_policy: ["public"] },
      latency_mode: "standard",
      reconnect_window: 60,
      passthrough: title || "Primal Live"
    })
  });
  const j = await resp.json();
  if (!resp.ok) throw new Error(j?.error?.message || "Mux error");
  return j.data;
}

app.post("/api/mux/create", requireRole("CREATOR","ADMIN"), async (req, res) => {
  try {
    const streamId = req.body.streamId;
    const s = await get("SELECT * FROM streams WHERE id=?", [streamId]);
    if (!s) return res.status(404).json({ error: "Stream not found" });
    if (req.session.user.role !== "ADMIN" && s.creatorId !== req.session.user.id) return res.status(403).json({ error: "Forbidden" });

    const data = await muxCreateLiveStream(s.title);
    const rtmpUrl = data.rtmp?.url;
    const streamKey = data.rtmp?.stream_key;
    const playbackId = data.playback_ids?.[0]?.id;

    await run("UPDATE streams SET ingestType='RTMP', muxLiveStreamId=?, muxPlaybackId=? WHERE id=?",
      [data.id, playbackId, streamId]);

    res.json({ ok: true, rtmpUrl, streamKey, playbackId });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// -------- WebSocket rooms: signaling + chat events --------
const socketsByRoom = new Map(); // room -> Set(ws)
const socketMeta = new Map();    // ws -> {room, peerId}

function sendToPeer(room, toPeerId, obj) {
  const set = socketsByRoom.get(room);
  if (!set) return;
  const msg = JSON.stringify(obj);
  for (const ws of set) {
    const meta = socketMeta.get(ws);
    if (meta && meta.peerId === toPeerId && ws.readyState === ws.OPEN) ws.send(msg);
  }
}

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let data;
    try { data = JSON.parse(raw.toString("utf8")); } catch { return; }
    const { room, type, to, from } = data;
    if (!room || !type) return;

    if (type === "join") {
      const peerId = data.peerId || uuidv4();
      socketMeta.set(ws, { room, peerId });
      if (!socketsByRoom.has(room)) socketsByRoom.set(room, new Set());
      socketsByRoom.get(room).add(ws);

      broadcastRoom(room, { type: "peer-joined", room, peerId });
      ws.send(JSON.stringify({ type: "joined", room, peerId }));
      return;
    }

    // Relay: targeted or broadcast
    if (to) sendToPeer(room, to, data);
    else broadcastRoom(room, data);
  });

  ws.on("close", () => {
    const meta = socketMeta.get(ws);
    if (!meta) return;
    const set = socketsByRoom.get(meta.room);
    if (set) set.delete(ws);
    socketMeta.delete(ws);
    broadcastRoom(meta.room, { type: "peer-left", room: meta.room, peerId: meta.peerId });
  });
});

// -------- Start --------
(async () => {
  await init();
  server.listen(PORT, () => console.log(`Primal Live running on :${PORT}`));
})();
