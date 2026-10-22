const express = require('express'), http = require('http'), path = require('path');
const { Server } = require('socket.io');
const WORDS = require('./words');
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_, r) => r.send('ok'));
const server = http.createServer(app);
const io = new Server(server);

const TARGET = +process.env.BLOT_TARGET || 15, REVEAL = +process.env.BLOT_REVEAL || 3500, ROUND = +process.env.BLOT_ROUND || 60, MAXP = 6;
const EMOJI = ['🦊', '🐼', '🦁', '🐙', '🦄', '🐸'];
const rooms = new Map();
const code = () => { let c; do { c = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.random() * 24 | 0]).join(''); } while (rooms.has(c)); return c; };
const clean = n => String(n || 'שחקנית').replace(/[<>]/g, '').trim().slice(0, 12) || 'שחקנית';
const FIN = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const norm = s => String(s).normalize('NFKD').replace(/[\u0591-\u05C7]/g, '').replace(/[ךםןףץ]/g, c => FIN[c]).replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
const toks = s => String(s).split(/[^\p{L}\p{N}]+/u).map(norm).filter(Boolean);
const leak = (clue, word) => { const w = norm(word); return w.length < 3 ? toks(clue).includes(w) : norm(clue).includes(w); };
const correct = (g, word) => { const w = norm(word); if (norm(g) === w) return true; return !/\s/.test(word.trim()) && toks(g).some(t => t === w || t === 'ה' + w); };

const pub = r => ({ code: r.code, phase: r.phase, target: TARGET, players: r.players.map(p => ({ name: p.name, emoji: p.emoji, pos: p.pos, connected: p.connected })), round: r.round && { d: r.round.d, cat: r.round.cat, len: r.round.word.trim().split(/\s+/).map(x => x.length), t: r.round.t, over: r.round.over } });
const sync = r => io.to(r.code).emit('room', pub(r));
function pickWord(r) {
  const all = []; for (const c in WORDS) WORDS[c].forEach(w => { if (!r.used.has(w)) all.push([c, w]); });
  if (!all.length) { r.used.clear(); return pickWord(r); }
  const [cat, word] = all[Math.random() * all.length | 0]; r.used.add(word); return { cat, word };
}
function sendWord(r) { const d = r.players[r.round.d]; if (d && d.sid && d.connected) io.to(d.sid).emit('word', { word: r.round.word, skip: r.round.skip }); }
function startRound(r) {
  clearInterval(r.iv); clearTimeout(r.to);
  const n = r.players.length; let tries = 0;
  do { r.turn = (r.turn + 1) % n; tries++; } while (!r.players[r.turn].connected && tries <= n);
  const { cat, word } = pickWord(r);
  r.round = { d: r.turn, cat, word, t: ROUND, skip: false, over: false };
  sync(r); sendWord(r);
  io.to(r.code).emit('chat', { k: 'sys', text: `🎤 התור של ${r.players[r.turn].name} לתאר. כולם מנחשים!` });
  r.iv = setInterval(() => { r.round.t--; io.to(r.code).emit('tick', r.round.t); if (r.round.t <= 0) endRound(r, -1); }, 1000);
}
function endRound(r, g) {
  if (!r.round || r.round.over) return;
  clearInterval(r.iv); r.round.over = true;
  const d = r.round.d, fast = g >= 0 && r.round.t >= ROUND - 20;
  if (g >= 0) { r.players[g].pos += fast ? 2 : 1; r.players[d].pos += 1; }
  io.to(r.code).emit('reveal', { word: r.round.word, winner: g, d, fast }); sync(r);
  const w = r.players.map((p, i) => [p.pos, i]).filter(x => x[0] >= TARGET);
  if (w.length) {
    r.phase = 'ended';
    const best = g >= 0 && r.players[g].pos >= TARGET ? g : w.sort((a, b) => b[0] - a[0])[0][1];
    io.to(r.code).emit('end', { winner: best, name: r.players[best].name }); sync(r); return;
  }
  r.to = setTimeout(() => startRound(r), REVEAL);
}
setInterval(() => { for (const [k, r] of rooms) if (!r.players.some(p => p.connected) && Date.now() - r.last > 600000) { clearInterval(r.iv); clearTimeout(r.to); rooms.delete(k); } }, 60000);

io.on('connection', sock => {
  let room = null, idx = -1;
  const me = () => room && room.players[idx];
  const attach = (r, i) => {
    room = r; idx = i; const p = r.players[i]; p.sid = sock.id; p.connected = true; r.last = Date.now(); sock.join(r.code);
    sock.emit('joined', { code: r.code, you: i }); sync(r);
    if (r.phase !== 'lobby') { sock.emit('start'); if (r.phase === 'playing' && r.round && !r.round.over && r.round.d === i) sendWord(r); }
  };
  sock.on('create', ({ name, pid }) => {
    const r = { code: code(), phase: 'lobby', players: [], used: new Set(), turn: -1, round: null, last: Date.now() };
    rooms.set(r.code, r); r.players.push({ pid, name: clean(name), emoji: EMOJI[0], pos: 0, connected: true }); attach(r, 0);
  });
  sock.on('join', ({ code: c, name, pid }) => {
    const r = rooms.get(String(c || '').toUpperCase().trim());
    if (!r) return sock.emit('err', 'החדר לא נמצא. בדקי את הקוד!');
    const i = r.players.findIndex(p => p.pid === pid);
    if (i >= 0) return attach(r, i);
    if (r.phase !== 'lobby') return sock.emit('err', 'המשחק כבר התחיל.');
    if (r.players.length >= MAXP) return sock.emit('err', 'החדר מלא (עד 6 משתתפים).');
    r.players.push({ pid, name: clean(name), emoji: EMOJI[r.players.length], pos: 0, connected: true }); attach(r, r.players.length - 1);
  });
  sock.on('start', () => {
    if (!room || idx !== 0 || room.phase === 'playing' || room.players.filter(p => p.connected).length < 2) return;
    room.players.forEach(p => (p.pos = 0)); room.used.clear(); room.turn = -1; room.phase = 'playing';
    io.to(room.code).emit('start'); startRound(room);
  });
  sock.on('say', ({ text }) => {
    if (!room || room.phase !== 'playing' || !room.round || room.round.over) return;
    text = String(text || '').trim().slice(0, 100); if (!text) return;
    const p = me(); if (Date.now() - (p.last || 0) < 400) return; p.last = Date.now();
    const R = room.round;
    if (idx === R.d) {
      if (leak(text, R.word)) return sock.emit('blocked', 'אסור להגיד את המילה (או חלק ממנה)!');
      io.to(room.code).emit('chat', { k: 'clue', from: idx, text });
    } else {
      const ok = correct(text, R.word);
      io.to(room.code).emit('chat', { k: 'guess', from: idx, text, ok });
      if (ok) endRound(room, idx);
    }
  });
  sock.on('skip', () => {
    if (!room || room.phase !== 'playing' || !room.round || room.round.over || idx !== room.round.d || room.round.skip) return;
    const { cat, word } = pickWord(room); Object.assign(room.round, { cat, word, skip: true });
    sendWord(room); sync(room); io.to(room.code).emit('chat', { k: 'sys', text: '⏭️ המתארת החליפה מילה' });
  });
  const leave = hard => {
    if (!room) return; const r = room, i = idx, p = me(); room = null; idx = -1; sock.leave(r.code);
    if (!p || p.sid !== sock.id) return;
    p.connected = false; r.last = Date.now();
    if (hard && r.phase === 'lobby') {
      if (i === 0) { io.to(r.code).emit('left', 'המארחת סגרה את החדר.'); rooms.delete(r.code); return; }
      r.players.splice(i, 1); r.players.forEach((q, j) => { q.emoji = EMOJI[j]; if (q.sid && q.connected) io.to(q.sid).emit('joined', { code: r.code, you: j }); });
    }
    sync(r);
  };
  sock.on('leave', () => { leave(true); sock.emit('left'); });
  sock.on('disconnect', () => leave(false));
});
const PORT = process.env.PORT || 3000;
if (require.main === module) server.listen(PORT, () => console.log('Blot on :' + PORT));
module.exports = { server, io };
