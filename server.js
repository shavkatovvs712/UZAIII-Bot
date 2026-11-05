require('dotenv').config();
const express = require('express');
const path = require('path');
const { db, today, dayOf, TZ } = require('./db');
const { bot, ADMINS, approvePayment, rejectPayment, PREMIUM_DAYS, PRICE } = require('./bot');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
const started = Date.now();

// --- Auth ---
const auth = (req, res, next) => {
  if (req.headers['x-admin-password'] === process.env.ADMIN_PASSWORD) return next();
  res.status(401).json({ error: 'Parol noto\'g\'ri' });
};
app.post('/api/login', (req, res) =>
  req.body.password === process.env.ADMIN_PASSWORD ? res.json({ ok: true }) : res.status(401).json({ error: 'Parol noto\'g\'ri' }));
app.use('/api', auth);

// --- Statistika ---
const PRICE_IN = Number(process.env.PRICE_IN || 0.30), PRICE_OUT = Number(process.env.PRICE_OUT || 2.50);
app.get('/api/stats', (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 90);
  const now = Date.now();
  const one = (sql, ...a) => db.prepare(sql).get(...a).c;

  const dates = [];
  for (let i = days - 1; i >= 0; i--) dates.push(dayOf(now - i * 86400000));
  const since = Date.parse(dates[0] + 'T00:00:00Z') - TZ;

  const map = {};
  dates.forEach(d => map[d] = { date: d, dau: 0, new_users: 0, requests: 0, errors: 0, tokens_in: 0, tokens_out: 0, lat: 0 });
  db.prepare('SELECT date, COUNT(*) c FROM dau WHERE date>=? GROUP BY date').all(dates[0])
    .forEach(r => { if (map[r.date]) map[r.date].dau = r.c; });
  db.prepare('SELECT date, new_users FROM daily WHERE date>=?').all(dates[0])
    .forEach(r => { if (map[r.date]) map[r.date].new_users = r.new_users; });

  const cats = {};
  let tin = 0, tout = 0, lat = 0, errs = 0, reqs = 0;
  db.prepare('SELECT ts,category,tokens_in,tokens_out,latency,ok FROM requests_log WHERE ts>=?').all(since).forEach(r => {
    const m = map[dayOf(r.ts)]; if (!m) return;
    m.requests++; m.tokens_in += r.tokens_in; m.tokens_out += r.tokens_out; m.lat += r.latency;
    if (!r.ok) m.errors++;
    cats[r.category] = (cats[r.category] || 0) + 1;
    reqs++; tin += r.tokens_in; tout += r.tokens_out; lat += r.latency; if (!r.ok) errs++;
  });
  const series = dates.map(d => {
    const m = map[d];
    return { ...m, error_rate: m.requests ? +(m.errors / m.requests * 100).toFixed(2) : 0 };
  });
  const dauVals = series.map(s => s.dau);

  res.json({
    total: one('SELECT COUNT(*) c FROM users'),
    premium: one('SELECT COUNT(*) c FROM users WHERE premium_until>?', now),
    blocked: one('SELECT COUNT(*) c FROM users WHERE blocked=1'),
    activeToday: one('SELECT COUNT(*) c FROM dau WHERE date=?', today()),
    active7: one('SELECT COUNT(*) c FROM users WHERE last_active>?', now - 7 * 86400000),
    requestsTotal: one('SELECT COUNT(*) c FROM requests_log'),
    requestsToday: (map[today()] || {}).requests || 0,
    uptimeMin: Math.floor((now - started) / 60000),
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    aiKey: !!process.env.GEMINI_API_KEY,
    pendingPayments: one("SELECT COUNT(*) c FROM payments WHERE status='pending'"),
    premiumDays: PREMIUM_DAYS, premiumPrice: PRICE,
    summary: {
      days, requests: reqs, errors: errs, success: reqs - errs,
      errorRate: reqs ? +(errs / reqs * 100).toFixed(2) : 0,
      avgDau: Math.round(dauVals.reduce((a, b) => a + b, 0) / dauVals.length),
      peakDau: Math.max(0, ...dauVals),
      tokensIn: tin, tokensOut: tout, tokens: tin + tout,
      tokensPerDay: Math.round((tin + tout) / days),
      cost: +((tin / 1e6) * PRICE_IN + (tout / 1e6) * PRICE_OUT).toFixed(4),
      avgLatency: reqs ? Math.round(lat / reqs) : 0
    },
    categories: cats,
    series
  });
});

// --- Barcha so'rovlar ---
app.get('/api/requests', (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  const { q = '', status = 'all', category = 'all' } = req.query;
  const where = ['1=1'], args = [];
  if (status === 'ok') where.push('r.ok=1');
  if (status === 'err') where.push('r.ok=0');
  if (category !== 'all') { where.push('r.category=?'); args.push(category); }
  if (q) {
    where.push('(r.question LIKE ? OR u.first_name LIKE ? OR u.username LIKE ? OR CAST(r.user_id AS TEXT) LIKE ?)');
    const l = `%${q}%`; args.push(l, l, l, l);
  }
  const base = `FROM requests_log r LEFT JOIN users u ON u.id=r.user_id WHERE ${where.join(' AND ')}`;
  const total = db.prepare(`SELECT COUNT(*) c ${base}`).get(...args).c;
  const rows = db.prepare(`SELECT r.*, u.first_name, u.username ${base} ORDER BY r.id DESC LIMIT ? OFFSET ?`)
    .all(...args, limit, (page - 1) * limit);
  res.json({ total, page, pages: Math.max(1, Math.ceil(total / limit)), rows });
});

// --- To'lovlar (chek tasdiqlash) ---
app.get('/api/payments', (req, res) => {
  const { status = 'pending' } = req.query;
  const where = status === 'all' ? '1=1' : 'p.status=?';
  const rows = db.prepare(`SELECT p.*, u.first_name, u.username FROM payments p LEFT JOIN users u ON u.id=p.user_id
    WHERE ${where} ORDER BY p.id DESC LIMIT 100`).all(...(status === 'all' ? [] : [status]));
  const count = (st) => db.prepare('SELECT COUNT(*) c FROM payments WHERE status=?').get(st).c;
  res.json({ rows, pending: count('pending'), approved: count('approved'), rejected: count('rejected') });
});
app.get('/api/payments/:id/file', async (req, res) => {
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Topilmadi' });
  try {
    const f = await bot.api.getFile(p.file_id);
    const r = await fetch(`https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${f.file_path}`);
    const ext = (f.file_path.split('.').pop() || '').toLowerCase();
    res.set('Content-Type', { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf' }[ext] || 'application/octet-stream');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/payments/:id/approve', (req, res) => {
  const r = approvePayment(Number(req.params.id), 'web');
  r.ok ? res.json(r) : res.status(400).json({ error: r.error });
});
app.post('/api/payments/:id/reject', (req, res) => {
  const r = rejectPayment(Number(req.params.id), 'web', String(req.body.reason || '').slice(0, 200));
  r.ok ? res.json(r) : res.status(400).json({ error: r.error });
});

// --- Foydalanuvchilar ---
app.get('/api/users', (req, res) => {
  const { filter = 'all', q = '' } = req.query;
  const now = Date.now();
  let where = '1=1';
  if (filter === 'premium') where = `premium_until>${now}`;
  if (filter === 'free') where = `premium_until<=${now}`;
  if (filter === 'blocked') where = 'blocked=1';
  if (filter === 'admin') where = 'is_admin=1';
  const like = `%${q}%`;
  const rows = db.prepare(`SELECT * FROM users WHERE ${where}
    AND (CAST(id AS TEXT) LIKE ? OR username LIKE ? OR first_name LIKE ?)
    ORDER BY last_active DESC LIMIT 500`).all(like, like, like);
  res.json(rows.map(u => ({ ...u, premium: u.premium_until > now })));
});

app.post('/api/users/:id/premium', (req, res) => {
  const days = Math.max(1, Number(req.body.days) || 30);
  const u = db.prepare('SELECT premium_until FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Topilmadi' });
  const base = Math.max(Date.now(), u.premium_until);
  db.prepare('UPDATE users SET premium_until=? WHERE id=?').run(base + days * 86400000, req.params.id);
  bot.api.sendMessage(req.params.id, `🎉 Sizga ${days} kunlik Premium berildi!`).catch(() => {});
  res.json({ ok: true });
});
app.post('/api/users/:id/free', (req, res) => {
  db.prepare('UPDATE users SET premium_until=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});
app.post('/api/users/:id/block', (req, res) => {
  db.prepare('UPDATE users SET blocked=1 WHERE id=? AND is_admin=0').run(req.params.id);
  res.json({ ok: true });
});
app.post('/api/users/:id/unblock', (req, res) => {
  db.prepare('UPDATE users SET blocked=0 WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// --- Hammaga premium ---
app.post('/api/premium-all', (req, res) => {
  const days = Math.max(1, Number(req.body.days) || 30);
  const now = Date.now();
  const r = db.prepare(`UPDATE users SET premium_until = MAX(?, premium_until) + ? WHERE blocked=0`)
    .run(now, days * 86400000);
  res.json({ ok: true, updated: r.changes });
});
app.post('/api/revoke-all', (req, res) => {
  const r = db.prepare('UPDATE users SET premium_until=0').run();
  res.json({ ok: true, updated: r.changes });
});

// --- Xabarnoma ---
const audienceSql = {
  all: '1=1',
  premium: () => `premium_until>${Date.now()}`,
  free: () => `premium_until<=${Date.now()}`,
  active: () => `last_active>${Date.now() - 7 * 86400000}`
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

app.post('/api/broadcast', async (req, res) => {
  const { audience = 'all', text = '', test = false } = req.body;
  if (!text.trim()) return res.status(400).json({ error: 'Matn bo\'sh' });
  if (test) {
    let ok = 0;
    for (const id of ADMINS) { try { await bot.api.sendMessage(id, text, { parse_mode: 'HTML' }); ok++; } catch (e) {} }
    return res.json({ ok: true, sent: ok, test: true });
  }
  const cond = typeof audienceSql[audience] === 'function' ? audienceSql[audience]() : audienceSql.all;
  const ids = db.prepare(`SELECT id FROM users WHERE blocked=0 AND ${cond}`).all().map(r => r.id);
  const { lastInsertRowid: bid } = db.prepare(
    'INSERT INTO broadcasts(audience,text,total,created_at) VALUES(?,?,?,?)').run(audience, text, ids.length, Date.now());
  res.json({ ok: true, id: bid, total: ids.length });

  (async () => {
    let sent = 0, failed = 0;
    for (const id of ids) {
      try { await bot.api.sendMessage(id, text, { parse_mode: 'HTML' }); sent++; }
      catch (e) { failed++; }
      if ((sent + failed) % 10 === 0) db.prepare('UPDATE broadcasts SET sent=?, failed=? WHERE id=?').run(sent, failed, bid);
      await sleep(40); // ~25 xabar/soniya
    }
    db.prepare("UPDATE broadcasts SET sent=?, failed=?, status='done' WHERE id=?").run(sent, failed, bid);
  })();
});
app.get('/api/broadcasts', (req, res) =>
  res.json(db.prepare('SELECT * FROM broadcasts ORDER BY id DESC LIMIT 20').all()));

app.listen(process.env.PORT || 3000, () => console.log('Admin panel: http://localhost:' + (process.env.PORT || 3000)));
bot.start({
  onStart: (me) => {
    console.log('Bot ishga tushdi: @' + me.username);
    bot.api.setMyCommands([
      { command: 'start', description: '🏠 Bosh menyu' }, { command: 'premium', description: '💎 Premium olish' },
      { command: 'profil', description: '👤 Profilim' }, { command: 'help', description: '❓ Yordam' }
    ]).catch(() => {});
  }
});
