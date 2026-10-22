process.env.BLOT_TARGET = '4'; process.env.BLOT_REVEAL = '150';
const { server } = require('./server'); const { io: C } = require('socket.io-client');
const assert = require('assert'); const sleep = ms => new Promise(r => setTimeout(r, ms));
server.listen(0, async () => {
  const url = 'http://localhost:' + server.address().port; let ok = 0; const t = (n, f) => { f(); console.log('PASS', n); ok++; };
  const mk = () => { const s = C(url, { forceNew: true }); s.log = []; s.onAny((e, d) => s.log.push([e, d])); s.last = e => [...s.log].reverse().find(x => x[0] === e)?.[1]; s.count = e => s.log.filter(x => x[0] === e).length; return s; };
  const S = Array.from({ length: 7 }, mk);
  S[0].emit('create', { name: 'דיקלה', pid: 'p0' }); await sleep(150); const code = S[0].last('joined').code;
  for (let i = 1; i < 7; i++) { S[i].emit('join', { code, name: 'ש' + i, pid: 'p' + i }); await sleep(60); }
  t('6 join, 7th rejected', () => { assert.equal(S[0].last('room').players.length, 6); assert.match(S[6].last('err'), /מלא/); });
  S[1].emit('start'); await sleep(100); t('guest cannot start', () => assert.equal(S[0].last('room').phase, 'lobby'));
  S[0].emit('start'); await sleep(300);
  const play = S.slice(0, 6); let res = null; play.forEach(s => s.on('end', d => (res = d)));
  const dIdx = () => play[0].last('room').round.d;
  t('only describer receives the word', () => { const d = dIdx(); assert(play[d].last('word')); play.forEach((s, i) => i !== d && assert(!s.last('word') || s.count('word') === 0)); });
  let d = dIdx(), w = play[d].last('word').word;
  play[d].emit('say', { text: 'זה ' + w + ' ברור' }); await sleep(100);
  t('leak blocked, not broadcast', () => { assert(play[d].last('blocked')); assert.equal(play[1 === d ? 2 : 1].count('chat') && play[1 === d ? 2 : 1].log.filter(x => x[0] === 'chat' && x[1].k === 'clue').length, 0); });
  play[d].emit('say', { text: 'משהו שאוהבים' }); await sleep(500);
  const g = (d + 1) % 6; play[g].emit('say', { text: 'טעות מוחלטת' }); await sleep(500);
  t('wrong guess does not end round', () => assert.equal(play[0].count('reveal'), 0));
  const before = play[0].last('room').players.map(p => p.pos);
  play[g].emit('say', { text: w + '?' }); await sleep(300);
  t('correct guess advances guesser(+2 fast) and describer(+1)', () => { const after = play[0].last('room').players.map(p => p.pos); assert.equal(after[g] - before[g], 2); assert.equal(after[d] - before[d], 1); assert.equal(play[3].last('reveal').winner, g); });
  for (let i = 0; i < 40 && !res; i++) { await sleep(250); const rd = play[0].last('room').round; if (!rd || rd.over) continue; const dd = rd.d, ww = play[dd].last('word')?.word; if (!ww) continue; play[(dd + 1) % 6].emit('say', { text: ww }); }
  t('everyone sees the same winner', () => { assert(res); assert.deepEqual(play[0].last('end'), play[5].last('end')); });
  console.log('winner', res.name);
  S[0].emit('start'); await sleep(300);
  t('rematch resets positions', () => assert(play[0].last('room').players.every(p => p.pos === 0) && play[0].last('room').phase === 'playing'));
  console.log(ok + ' checks passed'); process.exit(0);
});
