import type { ParityCase } from '../../src/types.ts';

/**
 * `fs.WriteStream` chunk kinds + repeated-end semantics (review 2026-07-05
 * handoff #5/#6, probed against Node v24):
 *  - generic TypedArrays/DataViews are valid chunks — their raw bytes land;
 *  - invalid chunks throw ERR_INVALID_ARG_TYPE synchronously with Node's text;
 *  - end(chunk, cb) after 'finish' → cb(ERR_STREAM_WRITE_AFTER_END), NO
 *    'error' event, file untouched;
 *  - end(cb) with no chunk after 'finish' → cb(ERR_STREAM_ALREADY_FINISHED);
 *  - same-tick double end(chunk, cb) → BOTH cbs get WRITE_AFTER_END, the
 *    stream errors, and NOTHING is flushed (unlike write-after-end, which
 *    still persists the first chunk) — pre-open and post-open alike;
 *  - same-tick second end(cb) WITHOUT a chunk is clean: both cbs fire null.
 */
const c: ParityCase = {
  cwd: '/app',
  setup: { files: { 'app/seed.txt': 'seed' } },
  code: `
    const fs = require('node:fs');
    // timers/promises: keepalive-counted on the rifty side (harness drain).
    const { setTimeout: sleep } = require('node:timers/promises');

    (async () => {
      const ws1 = fs.createWriteStream('u16.bin');
      ws1.write(new Uint16Array([0x4241]));
      await new Promise((res) => ws1.end(new DataView(new Uint8Array([0x43, 0x44]).buffer), res));
      console.log('typedarray-bytes:',
        Array.from(fs.readFileSync('u16.bin')).map((b) => b.toString(16)).join(','));

      const ws2 = fs.createWriteStream('invalid.bin');
      for (const [label, chunk] of [['number', 42], ['arraybuffer', new ArrayBuffer(4)]]) {
        try {
          ws2.write(chunk);
          console.log('invalid-' + label + ': NO-THROW');
        } catch (e) {
          console.log('invalid-' + label + ':', e.code, '|', e.message);
        }
      }
      await new Promise((res) => ws2.end(res));

      const ws3 = fs.createWriteStream('after-finish.txt');
      const ev3 = [];
      ws3.on('error', (e) => ev3.push('error:' + e.code));
      ws3.on('finish', () => ev3.push('finish'));
      await new Promise((res) => ws3.end('first', () => { ev3.push('endcb1'); res(); }));
      await sleep(20);
      ws3.end('second', (e) => ev3.push('endcb2:' + (e ? e.code : 'null')));
      await sleep(50);
      console.log('end-chunk-after-finish:', ev3.join('|'),
        JSON.stringify(fs.readFileSync('after-finish.txt', 'utf8')));

      const ws4 = fs.createWriteStream('finished.txt');
      const ev4 = [];
      ws4.on('error', (e) => ev4.push('error:' + e.code));
      await new Promise((res) => ws4.end('x', () => { ev4.push('endcb1'); res(); }));
      await sleep(20);
      ws4.end((e) => ev4.push('endcb2:' + (e ? e.code : 'null')));
      await sleep(50);
      console.log('end-nochunk-after-finish:', ev4.join('|'));

      const ws5 = fs.createWriteStream('double.txt');
      const ev5 = [];
      ws5.on('error', (e) => ev5.push('error:' + e.code));
      ws5.on('finish', () => ev5.push('finish'));
      const closed5 = new Promise((res) => ws5.on('close', res));
      ws5.end('first', (e) => ev5.push('endcb1:' + (e ? e.code : 'null')));
      ws5.end('second', (e) => ev5.push('endcb2:' + (e ? e.code : 'null')));
      await closed5;
      await sleep(20);
      console.log('double-end-preopen:', ev5.join('|'),
        JSON.stringify(fs.readFileSync('double.txt', 'utf8')));

      const ws6 = fs.createWriteStream('double-post.txt');
      await new Promise((res, rej) => { ws6.on('ready', res); ws6.on('error', rej); });
      const ev6 = [];
      ws6.on('error', (e) => ev6.push('error:' + e.code));
      ws6.on('finish', () => ev6.push('finish'));
      const closed6 = new Promise((res) => ws6.on('close', res));
      ws6.end('first', (e) => ev6.push('endcb1:' + (e ? e.code : 'null')));
      ws6.end('second', (e) => ev6.push('endcb2:' + (e ? e.code : 'null')));
      await closed6;
      await sleep(20);
      console.log('double-end-postopen:', ev6.join('|'),
        JSON.stringify(fs.readFileSync('double-post.txt', 'utf8')));

      const ws7 = fs.createWriteStream('double-nochunk.txt');
      const ev7 = [];
      ws7.on('error', (e) => ev7.push('error:' + e.code));
      ws7.on('finish', () => ev7.push('finish'));
      ws7.end('x', (e) => ev7.push('endcb1:' + (e ? e.code : 'null')));
      ws7.end((e) => ev7.push('endcb2:' + (e ? e.code : 'null')));
      await sleep(50);
      console.log('double-end-nochunk:', ev7.join('|'),
        JSON.stringify(fs.readFileSync('double-nochunk.txt', 'utf8')));
    })();
  `,
};

export default c;
