// Ishlatish:  node check-ai.js   — qaysi Gemini modeli sizda eng tez ishlashini ko'rsatadi
require('dotenv').config();
const KEY = process.env.GEMINI_API_KEY;
const MODELS = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-3.8-flash', 'gemini-flash-latest'];
const body = JSON.stringify({ contents: [{ parts: [{ text: 'Salom, bitta qisqa gap yoz' }] }] });
(async () => {
  console.log('Node', process.version, '\n');
  let s = Date.now();
  try { const r = await fetch(`https://api.telegram.org/bot${process.env.BOT_TOKEN}/getMe`, { signal: AbortSignal.timeout(15000) }); console.log('Telegram:', r.status, (Date.now() - s) + 'ms'); }
  catch (e) { console.log('Telegram: XATO', e.message); }
  const ok = [];
  for (const m of MODELS) {
    s = Date.now();
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY }, body, signal: AbortSignal.timeout(25000) });
      const t = await r.text(), ms = Date.now() - s;
      if (r.ok) { ok.push([m, ms]); console.log('✅', m.padEnd(26), ms + 'ms'); }
      else console.log('❌', m.padEnd(26), ms + 'ms', r.status, (JSON.parse(t).error?.message || t).slice(0, 70));
    } catch (e) { console.log('❌', m.padEnd(26), (Date.now() - s) + 'ms', e.name === 'TimeoutError' ? 'javob bermadi (25s)' : e.message); }
  }
  ok.sort((a, b) => a[1] - b[1]);
  console.log(ok.length ? `\nEng tezi: ${ok[0][0]} (${ok[0][1]}ms)\n.env ga yozing:  GEMINI_MODEL=${ok[0][0]}` : '\nHech bir model ishlamadi — natijani yuboring.');
})();
