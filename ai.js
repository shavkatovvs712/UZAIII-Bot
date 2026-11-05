const { spawn } = require('child_process');

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';
const MODEL = () => process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const TTS_MODEL = () => process.env.GEMINI_TTS_MODEL || 'gemini-3.1-flash-tts-preview';
const headers = () => ({ 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY });

function apiError(t) {
  try { const j = JSON.parse(t); return `${j.error?.code || ''} ${j.error?.message || t}`.slice(0, 300); }
  catch { return String(t).slice(0, 300); }
}

// ---------- Matn: model zanjiri (band bo'lsa keyingisiga o'tadi) ----------
const FIRST_BYTE_MS = () => Number(process.env.AI_FIRST_BYTE_MS || 10000);
const FALLBACKS = () => (process.env.GEMINI_FALLBACKS || 'gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3.1-flash-lite,gemini-flash-latest')
  .split(',').map(s => s.trim()).filter(Boolean);
let sticky = { model: null, until: 0 };   // ishlagan modelni 10 daqiqa eslab qolamiz

function mkBody(system, contents, thinking) {
  const b = { contents, systemInstruction: { parts: [{ text: system }] } };
  if (thinking) b.generationConfig = { thinkingConfig: { thinkingLevel: process.env.GEMINI_THINKING || 'low' } };
  return b;
}
function collect(j, acc, onText) {
  if (j.usageMetadata) acc.usage = j.usageMetadata;
  if (j.promptFeedback?.blockReason) acc.block = j.promptFeedback.blockReason;
  const c = j.candidates?.[0];
  if (c?.finishReason) acc.finish = c.finishReason;
  for (const p of c?.content?.parts || []) {
    if (p.text && !p.thought) { acc.text += p.text; onText && onText(acc.text); }
  }
}
const newAcc = () => ({ text: '', usage: {}, finish: '', block: '' });
const httpErr = (status, t) => Object.assign(new Error(apiError(t)), { status, body: t });

async function streamCall(model, body, onText) {
  const ac = new AbortController(), acc = newAcc();
  const fb = setTimeout(() => ac.abort(), FIRST_BYTE_MS()), hard = setTimeout(() => ac.abort(), 90000);
  try {
    let r;
    try {
      r = await fetch(`${BASE}${model}:streamGenerateContent?alt=sse`, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal: ac.signal });
    } catch (e) {
      throw Object.assign(new Error(ac.signal.aborted ? 'AI serveri javob bermadi (timeout)' : 'Tarmoq xatosi: ' + e.message), { net: true });
    }
    if (!r.ok) throw httpErr(r.status, await r.text());
    const reader = r.body.getReader(), dec = new TextDecoder();
    let buf = '';
    const eat = (line) => {
      line = line.trim();
      if (!line.startsWith('data:')) return;
      const js = line.slice(5).trim();
      if (!js || js === '[DONE]') return;
      try { collect(JSON.parse(js), acc, onText); } catch {}
    };
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        clearTimeout(fb);
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n')) >= 0) { eat(buf.slice(0, i)); buf = buf.slice(i + 1); }
      }
      if (buf) eat(buf);
    } catch (e) {
      if (!acc.text) throw Object.assign(new Error('AI oqimi uzildi/timeout'), { net: true });
    }
    return acc;
  } finally { clearTimeout(fb); clearTimeout(hard); }
}

async function generateCall(model, body) {   // oxirgi chora: oqimsiz so'rov
  const ac = new AbortController(), acc = newAcc();
  const t = setTimeout(() => ac.abort(), 45000);
  try {
    let txt, r;
    try {
      r = await fetch(`${BASE}${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal });
      txt = await r.text();
    } catch (e) {
      throw Object.assign(new Error(ac.signal.aborted ? 'AI serveri javob bermadi (timeout)' : 'Tarmoq xatosi: ' + e.message), { net: true });
    }
    if (!r.ok) throw httpErr(r.status, txt);
    collect(JSON.parse(txt), acc);
    return acc;
  } finally { clearTimeout(t); }
}

const noThink = new Set();   // thinkingLevel'ni qo'llamaydigan modellar
async function tryModel(model, system, contents, onText, fn = streamCall) {
  try { return await fn(model, mkBody(system, contents, !noThink.has(model)), onText); }
  catch (e) {
    if (e.status === 400 && /think/i.test(e.body || '') && !noThink.has(model)) {
      noThink.add(model);
      return await fn(model, mkBody(system, contents, false), onText);
    }
    throw e;
  }
}

async function streamGemini({ system, contents, onText }) {
  if (!process.env.GEMINI_API_KEY) {
    const t = '🤖 GEMINI_API_KEY sozlanmagan. .env fayliga kalitni yozing.';
    onText && onText(t);
    return { text: t, tin: 0, tout: 0 };
  }
  const t0 = Date.now(), primary = MODEL();
  let list = [primary, ...FALLBACKS().filter(m => m !== primary)];
  if (sticky.model && Date.now() < sticky.until) list = [sticky.model, ...list.filter(m => m !== sticky.model)];

  let acc, used, lastErr, onlyNet = true;
  for (const m of list) {
    try { acc = await tryModel(m, system, contents, onText); used = m; break; }
    catch (e) {
      lastErr = e;
      if (!e.net) onlyNet = false;
      const next = e.net || [404, 429, 500, 502, 503, 504].includes(e.status);
      console.warn(`[AI] ${m}: ${String(e.message).slice(0, 110)} -> ${next ? 'keyingi modelga o\'tilmoqda' : 'to\'xtadi'}`);
      if (!next) throw e;
    }
  }
  if (!acc && onlyNet) {   // hamma model "timeout" bo'ldi: oqimsiz usulni sinab ko'ramiz
    try { acc = await tryModel(list[0], system, contents, onText, generateCall); used = list[0]; onText && onText(acc.text); } catch (e) { lastErr = e; }
  }
  if (!acc) throw lastErr;
  sticky = used === primary ? { model: null, until: 0 } : { model: used, until: Date.now() + 10 * 60000 };
  console.log(`[AI] ${used}: ${Date.now() - t0} ms`);
  if (!acc.text.trim()) throw new Error(acc.block || acc.finish ? `Javob bloklandi (${acc.block || acc.finish})` : "Bo'sh javob keldi");
  const u = acc.usage;
  return { text: acc.text, tin: u.promptTokenCount || 0, tout: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) };
}

// ---------- Ovoz (TTS) ----------
async function tts(text) {
  const r = await fetch(`${BASE}${TTS_MODEL()}:generateContent`, {
    method: 'POST', headers: headers(), signal: AbortSignal.timeout(90000),
    body: JSON.stringify({
      contents: [{ parts: [{ text: 'Read aloud in a warm, natural, friendly tone: ' + text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: process.env.TTS_VOICE || 'Kore' } } }
      }
    })
  });
  const t = await r.text();
  if (!r.ok) throw new Error(apiError(t));
  const d = JSON.parse(t)?.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
  if (!d) throw new Error('TTS audio qaytarmadi');
  return Buffer.from(d, 'base64'); // PCM 16-bit, 24 kHz, mono
}

function ffmpegPath() { try { return require('ffmpeg-static') || 'ffmpeg'; } catch { return 'ffmpeg'; } }
function pcmToOgg(pcm) {
  return new Promise((res, rej) => {
    const p = spawn(ffmpegPath(), ['-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0',
      '-c:a', 'libopus', '-b:a', '32k', '-f', 'ogg', 'pipe:1']);
    const out = [];
    p.stdout.on('data', d => out.push(d));
    p.on('error', rej);
    p.on('close', c => c === 0 && out.length ? res(Buffer.concat(out)) : rej(new Error('ffmpeg xato: ' + c)));
    p.stdin.on('error', () => {});
    p.stdin.end(pcm);
  });
}
function pcmToWav(pcm, rate = 24000) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

// ---------- Matn yordamchilari ----------
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function mdToHtml(src) {
  const blocks = [];
  let s = src.replace(/```(\w+)?\n?([\s\S]*?)```/g, (_, l, c) => {
    blocks.push(`<pre><code>${esc(c.replace(/\n$/, ''))}</code></pre>`); return `\u0000${blocks.length - 1}\u0000`;
  });
  s = esc(s);
  s = s.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');
  s = s.replace(/^\s*[*-]\s+/gm, '• ');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
  return s;
}
function splitText(s, max = 3600) {
  const out = [];
  while (s.length > max) {
    let i = s.lastIndexOf('\n\n', max); if (i < max * 0.5) i = s.lastIndexOf('\n', max); if (i < max * 0.5) i = max;
    out.push(s.slice(0, i)); s = s.slice(i).replace(/^\s+/, '');
  }
  if (s.trim()) out.push(s);
  return out;
}
function speakable(t) {
  let s = t.replace(/```[\s\S]*?```/g, ' ').replace(/[`*#_>~]/g, '')
    .replace(/\p{Extended_Pictographic}|\uFE0F|\u200D|[\u20E3]/gu, '').replace(/https?:\/\/\S+/g, '')
    .replace(/[ \t]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
  if (s.length > 1200) { s = s.slice(0, 1200); const i = Math.max(s.lastIndexOf('.'), s.lastIndexOf('!'), s.lastIndexOf('?')); if (i > 600) s = s.slice(0, i + 1); }
  return s;
}

module.exports = { streamGemini, tts, pcmToOgg, pcmToWav, mdToHtml, splitText, speakable, esc };
