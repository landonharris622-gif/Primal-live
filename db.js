const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "primal_live.db");
const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function init() {
  await run(`PRAGMA journal_mode=WAL;`);
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'VIEWER',
      createdAt INTEGER NOT NULL
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS streams (
      id TEXT PRIMARY KEY,
      creatorId TEXT NOT NULL,
      title TEXT NOT NULL,
      ingestType TEXT NOT NULL DEFAULT 'WEBRTC',
      isLive INTEGER NOT NULL DEFAULT 0,
      viewerCount INTEGER NOT NULL DEFAULT 0,
      thumbnailPath TEXT,
      startedAt INTEGER,
      endedAt INTEGER,
      muxLiveStreamId TEXT,
      muxPlaybackId TEXT,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY(creatorId) REFERENCES users(id)
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS viewer_sessions (
      id TEXT PRIMARY KEY,
      streamId TEXT NOT NULL,
      sessionId TEXT NOT NULL,
      userId TEXT,
      lastSeenAt INTEGER NOT NULL,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY(streamId) REFERENCES streams(id)
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      streamId TEXT NOT NULL,
      userId TEXT NOT NULL,
      usernameSnapshot TEXT NOT NULL,
      message TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      FOREIGN KEY(streamId) REFERENCES streams(id)
    );
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS vods (
      id TEXT PRIMARY KEY,
      streamId TEXT,
      creatorId TEXT NOT NULL,
      title TEXT NOT NULL,
      filePath TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
  `);
}

module.exports = { db, run, get, all, init, DB_PATH };
