const { Bot, InlineKeyboard, Keyboard, InputFile } = require('grammy');
const { db, today, bump } = require('./db');
const ai = require('./ai');

const bot = new Bot(process.env.BOT_TOKEN);
const ADMINS = (process.env.ADMIN_IDS || '').split(',').map(s => Number(s.trim())).filter(Boolean);
const FREE_LIMIT = Number(process.env.FREE_DAILY_LIMIT || 20);
const PRICE = Number(process.env.PREMIUM_PRICE || 49000);
const PREMIUM_DAYS = Number(process.env.PREMIUM_DAYS || 30);
const CARD = process.env.CARD_NUMBER || '4916 9903 6294 0907';
const CARD_OWNER = process.env.CARD_OWNER || 'SOHIBA SHOMURATOVA';
const PORT = process.env.PORT || 3000;
const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const isPremium = (u) => u.premium_until > Date.now();
const isAdmin = (u) => !!u.is_admin || ADMINS.includes(u.id);
const esc = ai.esc;

// ---------- Rejimlar ----------
const BASE = `Sen UZAI — aqlli, do'stona va ishonchli sun'iy intellekt yordamchisisan 🤖.
QOIDALAR:
• Foydalanuvchi qaysi tilda yozsa (o'zbek lotin, rus, ingliz) o'sha tilda javob ber. Til noaniq bo'lsa — o'zbek tilida (lotin yozuvida).
• Ravon, tabiiy, to'liq va tushunarli yoz. Savolga aniq javob ber, muhim tafsilotlarni tushirib qoldirma, lekin keraksiz cho'zma.
• Har bir bo'lim va muhim fikrni mos emoji bilan boshla (masalan 💡 ✅ 📌 🚀 ⚠️ 🎯), matn jonli va chiroyli ko'rinsin.
• Markdown belgilarini (**, __, #, *) ISHLATMA. Ro'yxat uchun "•" yoki 1️⃣ 2️⃣ 3️⃣ ishlat.
• Kod faqat uchta teskari tirnoq (\`\`\`) ichida bo'lsin.
• Oxirida bitta qisqa foydali taklif yoki savol qo'sh.`;

const MODES = {
  chat:      { label: '💬 Savol-javob', cat: null, sys: '', hint: '💬 <b>Savol-javob rejimi</b>\nIstalgan savolingizni yozing yoki 🎤 ovozli xabar yuboring!' },
  vision:    { label: '📷 Rasm tahlili', cat: 'vision', sys: '', hint: '📷 <b>Rasm tahlili</b>\nRasm yuboring — nimalar borligini, matnni, xatolarni tahlil qilib beraman. Rasmga izoh yozsangiz, aynan shu savolga javob beraman.' },
  code:      { label: '💻 Dasturlash', cat: 'code', sys: `\nREJIM: Sen tajribali senior dasturchisan. Ishlaydigan, toza kod yoz, xatoni topib tushuntir, qisqa izoh ber. Kodni \`\`\` ichida ber.`, hint: '💻 <b>Dasturlash rejimi</b>\nKod yozdirish, xatoni topish yoki tushuntirish uchun savol/kodni yuboring. Xato skrinshotini ham tashlashingiz mumkin 📸' },
  translate: { label: '🌐 Tarjima', cat: 'translate', sys: `\nREJIM: Tarjimon. Foydalanuvchi matn yuborsa tarjima qil. Til aytilmasa: o'zbekcha matnni inglizchaga, boshqa tildagini o'zbekchaga o'gir. Avval tarjimani ber, so'ng 1 qatorda muhim izoh (agar kerak bo'lsa).`, hint: '🌐 <b>Tarjima rejimi</b>\nMatn yuboring. Tilni oxirida yozishingiz mumkin, masalan: <i>Salom, qalaysiz? → inglizcha</i>' },
  essay:     { label: '✍️ Insho yozish', cat: 'text', sys: `\nREJIM: Professional yozuvchi. Mavzu bo'yicha insho/maqola/xat yoz: kirish, asosiy qism, xulosa. Uslub ravon va jonli bo'lsin. Hajm aytilmasa o'rtacha (200-350 so'z).`, hint: '✍️ <b>Insho yozish</b>\nMavzuni yuboring (hajm, uslub, tilni ham yozishingiz mumkin). Masalan: <i>"Vatan" haqida 300 so\'zli insho</i>' },
  marketing: { label: '📢 Marketing', cat: 'marketing', sys: `\nREJIM: Marketolog va kopirayter. Sotuvchi, jozibali post, reklama matni, slogan va g'oyalar yarat. Qisqa, kuchli, harakatga chorlovchi yoz.`, hint: '📢 <b>Marketing rejimi</b>\nBiznesingiz/mahsulotingiz haqida yozing — post, reklama va sloganlar tayyorlayman.' },
  edu:       { label: '🎓 Ta\'lim', cat: 'edu', sys: `\nREJIM: Sabrli o\'qituvchi. Mavzuni oddiy tilda, misollar bilan, bosqichma-bosqich tushuntir. Kerak bo'lsa qisqa test yoki mashq taklif qil.`, hint: '🎓 <b>Ta\'lim rejimi</b>\nQaysi mavzuni o\'rganmoqchisiz? Masala, dars yoki imtihonga tayyorgarlik — hammasiga yordam beraman.' }
};

function classify(t) {
  const s = t.toLowerCase();
  if (/(tarjima|translate|переве|перевод)/.test(s)) return 'translate';
  if (/(kod|code|funksiya|function|javascript|python|html|css|sql|bug)/.test(s)) return 'code';
  if (/(reklama|marketing|post|e'lon|instagram|slogan|sotuv)/.test(s)) return 'marketing';
  if (/(insho|maqola|xat yoz|matn yoz|essay|hikoya|she'r)/.test(s)) return 'text';
  if (/(dars|o'rgat|tushuntir|imtihon|masala|formula)/.test(s)) return 'edu';
  return 'chat';
}

const menu = (admin) => {
  const k = new Keyboard()
    .text(MODES.chat.label).text(MODES.vision.label).row()
    .text(MODES.code.label).text(MODES.translate.label).row()
    .text(MODES.essay.label).text(MODES.marketing.label).row()
    .text(MODES.edu.label).text('💎 Premium').row()
    .text('👤 Profil').text('❓ Yordam');
  if (admin) k.row().text('🛡 Admin panel');
  return k.resized().persistent();
};

// ---------- Xotira (RAM) ----------
const history = new Map();       // userId -> contents[]
const busy = new Set();
const receiptWait = new Map();   // userId -> expiry
const lastAnswer = new Map();    // chatId:msgId -> text
const remember = (k, v) => { lastAnswer.set(k, v); if (lastAnswer.size > 300) lastAnswer.delete(lastAnswer.keys().next().value); };

// ---------- Middleware ----------
bot.use(async (ctx, next) => {
  if (!ctx.from) return;
  const f = ctx.from, now = Date.now();
  let u = db.prepare('SELECT * FROM users WHERE id=?').get(f.id);
  if (!u) {
    db.prepare(`INSERT INTO users(id,username,first_name,lang,is_admin,created_at,last_active) VALUES(?,?,?,?,?,?,?)`)
      .run(f.id, f.username || '', f.first_name || '', 'uz', ADMINS.includes(f.id) ? 1 : 0, now, now);
    bump('new_users');
  } else {
    db.prepare('UPDATE users SET username=?, first_name=?, last_active=? WHERE id=?').run(f.username || '', f.first_name || '', now, f.id);
    if (ADMINS.includes(f.id) && !u.is_admin) db.prepare('UPDATE users SET is_admin=1 WHERE id=?').run(f.id);
  }
  db.prepare('INSERT OR IGNORE INTO dau(date,user_id) VALUES(?,?)').run(today(), f.id);
  u = db.prepare('SELECT * FROM users WHERE id=?').get(f.id);
  if (u.blocked) { if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {}); return ctx.reply('⛔ Siz bloklangansiz.'); }
  ctx.u = u;
  return next();
});

// ---------- Buyruqlar va tugmalar ----------
const welcome = (ctx) => ctx.reply(
`Salom, <b>${esc(ctx.from.first_name)}</b>! 👋
Men <b>UZAI</b> — sizning aqlli yordamchingizman 🤖✨

Nimalar qila olaman:
💬 Istalgan savolga to'liq javob
📷 Rasmni tahlil qilish
🎤 Ovozli xabarni tushunib, ovoz bilan javob berish
💻 Dasturlash va xatolarni topish
🌐 Tarjima  •  ✍️ Insho  •  📢 Marketing  •  🎓 Ta'lim

Pastdagi tugmalardan tanlang yoki shunchaki yozing / ovozli xabar yuboring 👇`,
  { parse_mode: 'HTML', reply_markup: menu(isAdmin(ctx.u)) });

bot.command('start', welcome);
bot.command('help', (ctx) => help(ctx));
bot.hears('❓ Yordam', (ctx) => help(ctx));
function help(ctx) {
  return ctx.reply(
`❓ <b>Yordam</b>

• Savolingizni yozing yoki 🎤 ovozli xabar yuboring
• 📷 Rasm yuboring — tahlil qilaman
• Tugmalar orqali rejimni tanlang (kod, tarjima, insho...)
• Javob ostidagi 🔊 tugmasi javobni ovozda eshittiradi
• /profil — tarifingiz va limitingiz
• /premium — Premium olish

Bepul tarifda kuniga ${FREE_LIMIT} ta so'rov, Premiumda cheklovsiz 💎`, { parse_mode: 'HTML' });
}

bot.command('profil', (ctx) => profile(ctx));
bot.hears('👤 Profil', (ctx) => profile(ctx));
function profile(ctx) {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(ctx.from.id), d = today();
  const used = u.used_date === d ? u.used_today : 0;
  const plan = isPremium(u) ? `💎 Premium (${new Date(u.premium_until).toLocaleDateString('ru-RU')} gacha)` : '🆓 Bepul';
  const lim = isPremium(u) ? '♾ cheksiz' : `${used}/${FREE_LIMIT}`;
  return ctx.reply(`👤 <b>${esc(u.first_name)}</b>\n🆔 <code>${u.id}</code>\n📦 Tarif: ${plan}\n⚡ Bugungi so'rovlar: ${lim}\n📊 Jami so'rovlar: ${u.requests}\n🎛 Rejim: ${(MODES[u.mode] || MODES.chat).label}`, { parse_mode: 'HTML' });
}

for (const [key, m] of Object.entries(MODES)) {
  bot.hears(m.label, (ctx) => {
    db.prepare('UPDATE users SET mode=? WHERE id=?').run(key, ctx.u.id);
    history.delete(ctx.u.id);
    receiptWait.delete(ctx.u.id);
    return ctx.reply(m.hint, { parse_mode: 'HTML' });
  });
}

// ---------- Premium va to'lov ----------
bot.command('premium', (ctx) => showPremium(ctx));
bot.hears('💎 Premium', (ctx) => showPremium(ctx));
bot.callbackQuery('prem', async (ctx) => { await ctx.answerCallbackQuery(); showPremium(ctx); });
function showPremium(ctx) {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(ctx.from.id);
  const st = isPremium(u) ? `\n✅ Sizda Premium bor: <b>${new Date(u.premium_until).toLocaleDateString('ru-RU')}</b> gacha. Uzaytirish uchun to'lov qilishingiz mumkin.\n` : '';
  return ctx.reply(
`💎 <b>UZAI Premium</b>
${st}
✨ <b>Nimalar beradi:</b>
• ♾ Cheksiz so'rovlar
• ⚡ Tezkor va ustuvor javoblar
• 📷 Rasm, 🎤 ovoz va 💻 kod bilan cheklovsiz ishlash

💰 Narxi: <b>${fmt(PRICE)} so'm</b> / ${PREMIUM_DAYS} kun

💳 Karta raqami:
<code>${CARD}</code>
👤 ${esc(CARD_OWNER)}

📌 <b>Qanday olinadi:</b>
1️⃣ ${fmt(PRICE)} so'mni yuqoridagi kartaga o'tkazing
2️⃣ «📤 Chek yuboraman» tugmasini bosing va chek rasmini (skrinshot) yuboring
3️⃣ Admin tekshirib tasdiqlagach, Premium avtomatik yoqiladi 🎉`,
  { parse_mode: 'HTML', reply_markup: new InlineKeyboard().text('📤 Chek yuboraman', 'pay:start') });
}
bot.callbackQuery('pay:start', async (ctx) => {
  receiptWait.set(ctx.from.id, Date.now() + 30 * 60000);
  await ctx.answerCallbackQuery();
  return ctx.reply('📸 To\'lov chekining rasmini (skrinshot) shu yerga yuboring.\nBekor qilish uchun istalgan tugmani bosing.');
});

function createPayment(ctx, fileId, type) {
  const pend = db.prepare("SELECT COUNT(*) c FROM payments WHERE user_id=? AND status='pending'").get(ctx.u.id).c;
  if (pend >= 3) return ctx.reply('⏳ Sizda tekshirilayotgan cheklar bor. Iltimos, admin javobini kuting.');
  const r = db.prepare('INSERT INTO payments(user_id,file_id,file_type,amount,days,created_at) VALUES(?,?,?,?,?,?)')
    .run(ctx.u.id, fileId, type, PRICE, PREMIUM_DAYS, Date.now());
  const id = Number(r.lastInsertRowid);
  receiptWait.delete(ctx.u.id);
  const cap = `💳 <b>Yangi to'lov cheki #${id}</b>\n👤 ${esc(ctx.from.first_name)} ${ctx.from.username ? '(@' + esc(ctx.from.username) + ')' : ''}\n🆔 <code>${ctx.u.id}</code>\n💰 ${fmt(PRICE)} so'm / ${PREMIUM_DAYS} kun`;
  const kb = new InlineKeyboard().text(`✅ ${PREMIUM_DAYS} kun Premium`, `pay:ok:${id}`).text('❌ Rad etish', `pay:no:${id}`);
  for (const a of ADMINS) {
    const send = type === 'photo' ? bot.api.sendPhoto(a, fileId, { caption: cap, parse_mode: 'HTML', reply_markup: kb })
                                  : bot.api.sendDocument(a, fileId, { caption: cap, parse_mode: 'HTML', reply_markup: kb });
    send.catch(() => {});
  }
  return ctx.reply(`✅ <b>Chek qabul qilindi!</b> (#${id})\nAdmin tekshirgach Premium yoqiladi va sizga xabar keladi. Odatda bir necha daqiqa ⏱`, { parse_mode: 'HTML' });
}

function approvePayment(id, by = 'admin') {
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(id);
  if (!p) return { ok: false, error: 'To\'lov topilmadi' };
  if (p.status !== 'pending') return { ok: false, error: 'Allaqachon ko\'rib chiqilgan (' + p.status + ')' };
  const u = db.prepare('SELECT premium_until FROM users WHERE id=?').get(p.user_id);
  const until = Math.max(Date.now(), u ? u.premium_until : 0) + (p.days || PREMIUM_DAYS) * 86400000;
  db.prepare('UPDATE users SET premium_until=? WHERE id=?').run(until, p.user_id);
  db.prepare("UPDATE payments SET status='approved', decided_at=?, decided_by=? WHERE id=?").run(Date.now(), String(by), id);
  bot.api.sendMessage(p.user_id, `🎉 <b>Tabriklaymiz!</b>\nTo'lovingiz tasdiqlandi, <b>${p.days || PREMIUM_DAYS} kunlik Premium</b> yoqildi 💎\n📅 Amal qilish muddati: <b>${new Date(until).toLocaleDateString('ru-RU')}</b>\n\nEndi cheklovsiz foydalanishingiz mumkin 🚀`, { parse_mode: 'HTML' }).catch(() => {});
  return { ok: true, until };
}
function rejectPayment(id, by = 'admin', reason = '') {
  const p = db.prepare('SELECT * FROM payments WHERE id=?').get(id);
  if (!p) return { ok: false, error: 'To\'lov topilmadi' };
  if (p.status !== 'pending') return { ok: false, error: 'Allaqachon ko\'rib chiqilgan (' + p.status + ')' };
  db.prepare("UPDATE payments SET status='rejected', decided_at=?, decided_by=?, note=? WHERE id=?").run(Date.now(), String(by), reason, id);
  bot.api.sendMessage(p.user_id, `❌ Chekingiz tasdiqlanmadi.${reason ? '\n📝 Sabab: ' + esc(reason) : ''}\nAgar xato bo'lgan deb o'ylasangiz, to'g'ri chekni qayta yuboring: /premium`, { parse_mode: 'HTML' }).catch(() => {});
  return { ok: true };
}

bot.callbackQuery(/^pay:(ok|no):(\d+)$/, async (ctx) => {
  if (!isAdmin(ctx.u)) return ctx.answerCallbackQuery({ text: '⛔ Faqat adminlar uchun' });
  const id = Number(ctx.match[2]);
  const r = ctx.match[1] === 'ok' ? approvePayment(id, ctx.from.id) : rejectPayment(id, ctx.from.id);
  await ctx.answerCallbackQuery({ text: r.ok ? (ctx.match[1] === 'ok' ? '✅ Premium yoqildi' : '❌ Rad etildi') : 'ℹ️ ' + r.error, show_alert: !r.ok });
  const status = r.ok ? (ctx.match[1] === 'ok' ? `✅ Tasdiqlandi — ${ctx.from.first_name}` : `❌ Rad etildi — ${ctx.from.first_name}`) : 'ℹ️ ' + r.error;
  ctx.editMessageCaption({ caption: (ctx.callbackQuery.message?.caption || '') + '\n\n' + status, reply_markup: new InlineKeyboard() }).catch(() => {});
});

// ---------- Admin (faqat adminlarga) ----------
bot.command('admin', (ctx) => adminMenu(ctx));
bot.hears('🛡 Admin panel', (ctx) => adminMenu(ctx));
function adminMenu(ctx) {
  if (!isAdmin(ctx.u)) return ctx.reply('⛔ Bu bo\'lim faqat adminlar uchun.');
  const pend = db.prepare("SELECT COUNT(*) c FROM payments WHERE status='pending'").get().c;
  const kb = new InlineKeyboard().text('📊 Statistika', 'adm:stats').text(`💳 To'lovlar (${pend})`, 'adm:pays');
  return ctx.reply(`🛡 <b>Admin panel</b>\n\n🌐 To'liq veb panel: <code>http://localhost:${PORT}</code>\n(statistika, foydalanuvchilar, xabarnoma, to'lovlar)`, { parse_mode: 'HTML', reply_markup: kb });
}
bot.callbackQuery('adm:stats', async (ctx) => {
  if (!isAdmin(ctx.u)) return ctx.answerCallbackQuery({ text: '⛔' });
  await ctx.answerCallbackQuery();
  const one = (q, ...a) => db.prepare(q).get(...a).c, now = Date.now();
  return ctx.reply(
`📊 <b>Statistika</b>
👥 Jami a'zolar: <b>${one('SELECT COUNT(*) c FROM users')}</b>
⚡ Bugun faol: <b>${one('SELECT COUNT(*) c FROM dau WHERE date=?', today())}</b>
💎 Premium: <b>${one('SELECT COUNT(*) c FROM users WHERE premium_until>?', now)}</b>
🔒 Bloklangan: <b>${one('SELECT COUNT(*) c FROM users WHERE blocked=1')}</b>
💬 Jami so'rovlar: <b>${one('SELECT COUNT(*) c FROM requests_log')}</b>
💳 Kutilayotgan to'lovlar: <b>${one("SELECT COUNT(*) c FROM payments WHERE status='pending'")}</b>`, { parse_mode: 'HTML' });
});
bot.callbackQuery('adm:pays', async (ctx) => {
  if (!isAdmin(ctx.u)) return ctx.answerCallbackQuery({ text: '⛔' });
  await ctx.answerCallbackQuery();
  const rows = db.prepare("SELECT p.*, u.first_name, u.username FROM payments p LEFT JOIN users u ON u.id=p.user_id WHERE p.status='pending' ORDER BY p.id LIMIT 10").all();
  if (!rows.length) return ctx.reply('✅ Kutilayotgan to\'lovlar yo\'q.');
  for (const p of rows) {
    const cap = `💳 <b>To'lov #${p.id}</b>\n👤 ${esc(p.first_name || '')} ${p.username ? '(@' + esc(p.username) + ')' : ''}\n🆔 <code>${p.user_id}</code>\n💰 ${fmt(p.amount)} so'm / ${p.days} kun`;
    const kb = new InlineKeyboard().text(`✅ ${p.days} kun Premium`, `pay:ok:${p.id}`).text('❌ Rad etish', `pay:no:${p.id}`);
    const opt = { caption: cap, parse_mode: 'HTML', reply_markup: kb };
    await (p.file_type === 'photo' ? ctx.replyWithPhoto(p.file_id, opt) : ctx.replyWithDocument(p.file_id, opt)).catch(() => {});
  }
});

// ---------- Javob berish (stream) ----------
const splitSafe = ai.splitText;
async function editSafe(chatId, mid, raw, markup) {
  try { await bot.api.editMessageText(chatId, mid, ai.mdToHtml(raw), { parse_mode: 'HTML', reply_markup: markup }); }
  catch (e) {
    if (/not modified/i.test(e.message)) return;
    try { await bot.api.editMessageText(chatId, mid, raw, { reply_markup: markup }); } catch (e2) { if (!/not modified/i.test(e2.message)) throw e2; }
  }
}
async function sendSafe(chatId, raw, markup) {
  try { return await bot.api.sendMessage(chatId, ai.mdToHtml(raw), { parse_mode: 'HTML', reply_markup: markup }); }
  catch { return await bot.api.sendMessage(chatId, raw, { reply_markup: markup }); }
}
async function download(fileId) {
  const f = await bot.api.getFile(fileId);
  const r = await fetch(`https://api.telegram.org/file/bot${process.env.BOT_TOKEN}/${f.file_path}`);
  if (!r.ok) throw new Error('Faylni yuklab bo\'lmadi');
  return { buf: Buffer.from(await r.arrayBuffer()), path: f.file_path };
}
const mimeOf = (p) => ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', oga: 'audio/ogg', ogg: 'audio/ogg', mp3: 'audio/mp3' })[(p.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';

async function sendVoiceReply(chatId, text) {
  const say = ai.speakable(text);
  if (!say) return;
  await bot.api.sendChatAction(chatId, 'record_voice').catch(() => {});
  const pcm = await ai.tts(say);
  try { await bot.api.sendVoice(chatId, new InputFile(await ai.pcmToOgg(pcm), 'javob.ogg')); }
  catch (e) {
    console.error('ffmpeg:', e.message);
    await bot.api.sendAudio(chatId, new InputFile(ai.pcmToWav(pcm), 'javob.wav'), { title: 'UZAI javobi' });
  }
}

async function respond(ctx, { parts, qText, category, sys = '', wantVoice = false, useHistory = true }) {
  const uid = ctx.u.id, chatId = ctx.chat.id, d = today();
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(uid);
  const used = u.used_date === d ? u.used_today : 0;
  if (!isPremium(u) && used >= FREE_LIMIT)
    return ctx.reply(`🚦 Bugungi bepul limit (${FREE_LIMIT} ta) tugadi.\nCheksiz foydalanish uchun Premium oling 💎`, { reply_markup: new InlineKeyboard().text('💎 Premium olish', 'prem') });
  if (busy.has(uid)) return ctx.reply('⏳ Oldingi javob tayyorlanmoqda, bir oz kuting...');
  busy.add(uid);

  const t0 = Date.now(), log = { ok: 1, err: '', ans: '', tin: 0, tout: 0 };
  const typing = setInterval(() => bot.api.sendChatAction(chatId, wantVoice ? 'record_voice' : 'typing').catch(() => {}), 4500);
  let mid;
  try {
    mid = (await ctx.reply('✨ O\'ylayapman...')).message_id;
    let last = 0, editing = false;
    const onText = (t) => {
      const now = Date.now();
      if (editing || now - last < 1100) return;
      last = now; editing = true;
      bot.api.editMessageText(chatId, mid, t.slice(0, 3900) + ' ▌').catch(() => {}).finally(() => { editing = false; });
    };
    const contents = [...(useHistory ? history.get(uid) || [] : []), { role: 'user', parts }];
    const r = await ai.streamGemini({ system: BASE + sys, contents, onText });
    const final = r.text.trim();
    while (editing) await new Promise(res => setTimeout(res, 50));

    const chunks = splitSafe(final);
    const kb = wantVoice ? undefined : new InlineKeyboard().text('🔊 Ovozli eshitish', 'tts');
    let lastId = mid;
    for (let i = 0; i < chunks.length; i++) {
      const mk = i === chunks.length - 1 ? kb : undefined;
      if (i === 0) await editSafe(chatId, mid, chunks[i], mk);
      else lastId = (await sendSafe(chatId, chunks[i], mk)).message_id;
    }
    remember(`${chatId}:${lastId}`, final);
    log.ans = final; log.tin = r.tin; log.tout = r.tout;

    if (useHistory && qText) {
      const h = history.get(uid) || [];
      h.push({ role: 'user', parts: [{ text: qText }] }, { role: 'model', parts: [{ text: final }] });
      history.set(uid, h.slice(-10));
    }
    db.prepare('UPDATE users SET requests=requests+1, used_today=?, used_date=? WHERE id=?').run(used + 1, d, uid);
    if (wantVoice) sendVoiceReply(chatId, final).catch(e => console.error('TTS:', e.message));
  } catch (e) {
    console.error('AI xato:', e.message);
    log.ok = 0; log.err = String(e.message).slice(0, 300);
    const msg = /429|quota|exhaust/i.test(e.message) ? '🚦 Hozir so\'rovlar juda ko\'p. Bir daqiqadan keyin qayta urinib ko\'ring.' : /timeout|Tarmoq|uzildi|503|high demand|UNAVAILABLE|404/i.test(e.message) ? '⏱ AI serveri hozir javob bermadi. Bir ozdan keyin qayta urinib ko\'ring 🙏' : '⚠️ Xatolik yuz berdi. Iltimos, qayta urinib ko\'ring 🙏';
    if (mid) bot.api.editMessageText(chatId, mid, msg).catch(() => {}); else ctx.reply(msg).catch(() => {});
  } finally {
    clearInterval(typing); busy.delete(uid);
    db.prepare(`INSERT INTO requests_log(ts,user_id,category,question,answer,tokens_in,tokens_out,latency,ok,error) VALUES(?,?,?,?,?,?,?,?,?,?)`)
      .run(Date.now(), uid, category, (qText || '').slice(0, 1000), log.ans.slice(0, 1500), log.tin, log.tout, Date.now() - t0, log.ok, log.err);
  }
}

// ---------- Kiruvchi xabarlar (parallel ishlaydi — navbat kutmaydi) ----------
bot.on('message:text', (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith('/')) return;
  const mode = MODES[ctx.u.mode] || MODES.chat;
  respond(ctx, { parts: [{ text }], qText: text, category: mode.cat || classify(text), sys: mode.sys }).catch(e => console.error(e));
});

bot.on('message:voice', (ctx) => {
  (async () => {
    if (ctx.message.voice.duration > 180) return ctx.reply('🎤 Ovozli xabar 3 daqiqadan oshmasin, iltimos.');
    const { buf } = await download(ctx.message.voice.file_id);
    await respond(ctx, {
      parts: [{ inlineData: { mimeType: 'audio/ogg', data: buf.toString('base64') } },
              { text: 'Bu foydalanuvchining ovozli xabari. Uni diqqat bilan tingla, nima so\'ralganini tushun va shu tilda javob ber. Javob ovozda o\'qib beriladi, shuning uchun aniq va ixcham bo\'lsin (taxminan 120 so\'zgacha).' }],
      qText: '🎤 [ovozli xabar]', category: 'voice', sys: (MODES[ctx.u.mode] || MODES.chat).sys, wantVoice: true, useHistory: false
    });
  })().catch(e => { console.error(e); ctx.reply('⚠️ Ovozli xabarni o\'qib bo\'lmadi.').catch(() => {}); });
});

bot.on('message:photo', (ctx) => {
  (async () => {
    const cap = ctx.message.caption || '';
    const fileId = ctx.message.photo.at(-1).file_id;
    if ((receiptWait.get(ctx.u.id) || 0) > Date.now() || /chek|to'lov|tolov|check|чек|оплат/i.test(cap))
      return createPayment(ctx, fileId, 'photo');
    const { buf, path } = await download(fileId);
    await respond(ctx, {
      parts: [{ inlineData: { mimeType: mimeOf(path), data: buf.toString('base64') } },
              { text: cap || 'Bu rasmni batafsil tahlil qil: nima tasvirlangan, muhim detallar, rasmda matn bo\'lsa uni o\'qib ber va foydali xulosa yoz.' }],
      qText: '📷 ' + (cap || '[rasm tahlili]'), category: 'vision', sys: '\nREJIM: Rasm tahlilchisi. Rasmni aniq va tartibli tahlil qil.', useHistory: false
    });
  })().catch(e => { console.error(e); ctx.reply('⚠️ Rasmni qayta ishlab bo\'lmadi.').catch(() => {}); });
});

bot.on('message:document', (ctx) => {
  if ((receiptWait.get(ctx.u.id) || 0) > Date.now()) return createPayment(ctx, ctx.message.document.file_id, 'document').catch(e => console.error(e));
  return ctx.reply('📎 Hozircha matn, 📷 rasm va 🎤 ovozli xabarlarni qabul qilaman. Chek yuborish uchun avval /premium ni bosing.');
});

bot.callbackQuery('tts', async (ctx) => {
  const m = ctx.callbackQuery.message;
  const text = m && lastAnswer.get(`${m.chat.id}:${m.message_id}`);
  if (!text) return ctx.answerCallbackQuery({ text: 'Bu javob eskirgan, yangi savol bering.' });
  await ctx.answerCallbackQuery({ text: '🔊 Ovoz tayyorlanmoqda...' });
  sendVoiceReply(m.chat.id, text).catch(e => { console.error('TTS:', e.message); bot.api.sendMessage(m.chat.id, '⚠️ Ovoz yaratib bo\'lmadi.').catch(() => {}); });
});

bot.catch((e) => console.error('Bot xatosi:', e.message));
module.exports = { bot, ADMINS, approvePayment, rejectPayment, PREMIUM_DAYS, PRICE };
