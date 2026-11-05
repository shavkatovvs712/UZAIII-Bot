const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('uzai.db');
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT, first_name TEXT, lang TEXT DEFAULT 'uz',
  premium_until INTEGER DEFAULT 0,
  blocked INTEGER DEFAULT 0,
  is_admin INTEGER DEFAULT 0,
  requests INTEGER DEFAULT 0,
  used_today INTEGER DEFAULT 0, used_date TEXT DEFAULT '',
  created_at INTEGER, last_active INTEGER
);
CREATE TABLE IF NOT EXISTS daily (
  date TEXT PRIMARY KEY, requests INTEGER DEFAULT 0, new_users INTEGER DEFAULT 0, errors INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS broadcasts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, audience TEXT, text TEXT,
  total INTEGER DEFAULT 0, sent INTEGER DEFAULT 0, failed INTEGER DEFAULT 0,
  status TEXT DEFAULT 'running', created_at INTEGER
);
CREATE TABLE IF NOT EXISTS dau (
  date TEXT, user_id INTEGER, PRIMARY KEY(date, user_id)
);
CREATE TABLE IF NOT EXISTS requests_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER, user_id INTEGER, category TEXT DEFAULT 'chat',
  question TEXT, answer TEXT,
  tokens_in INTEGER DEFAULT 0, tokens_out INTEGER DEFAULT 0,
  latency INTEGER DEFAULT 0, ok INTEGER DEFAULT 1, error TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_log_ts ON requests_log(ts);
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, file_id TEXT, file_type TEXT DEFAULT 'photo',
  amount INTEGER DEFAULT 0, days INTEGER DEFAULT 30, status TEXT DEFAULT 'pending',
  created_at INTEGER, decided_at INTEGER, decided_by TEXT, note TEXT DEFAULT ''
);
`);

try { db.exec("ALTER TABLE users ADD COLUMN mode TEXT DEFAULT 'chat'"); } catch (e) {}

const TZ = Number(process.env.TZ_OFFSET_H || 5) * 3600000;
const dayOf = (ts) => new Date(ts + TZ).toISOString().slice(0, 10);
const today = () => dayOf(Date.now());
const bump = (col) => db.prepare(
  `INSERT INTO daily(date, ${col}) VALUES(?,1) ON CONFLICT(date) DO UPDATE SET ${col}=${col}+1`
).run(today());

module.exports = { db, today, dayOf, bump, TZ };
