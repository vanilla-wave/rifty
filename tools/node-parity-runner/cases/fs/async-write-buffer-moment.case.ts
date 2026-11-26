import type { ParityCase } from '../../src/types.ts';

/**
 * An async write never changes the file after it completed: a mutation of the
 * caller's buffer once the callback ran / the promise settled leaves the file
 * alone, on every async write entry. Plus the caller-tick row that equals Node
 * by its own read moment (a WriteStream before open); after `fs.write(fd)` that
 * row races in Node (9,9,9 on macOS, 1,2,3 on Linux CI). Declared ≠
 * Node: a caller-tick mutation after promises.writeFile/appendFile, writeFile
 * cb or an open WriteStream's write (Node writes it, rifty reads at the call;
 * owner backlog runtime-js/fs-callbacks-io-turn). appendFile(cb), FileHandle:
 * missing (fs-callback-append-file-rm-missing, fs-promises-filehandle).
 */
const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    const bytes = (p) => Array.from(fs.readFileSync(p)).join(',');
    const done = (res, rej) => (e) => (e ? rej(e) : res());
    const entries = {
      'promises.writeFile': (p, b, s) => { const r = fs.promises.writeFile(p, b); s(); return r; },
      'promises.appendFile': (p, b, s) => { const r = fs.promises.appendFile(p, b); s(); return r; },
      'writeFile cb': (p, b, s) => new Promise((res, rej) => { fs.writeFile(p, b, done(res, rej)); s(); }),
      'write fd cb': (p, b, s) => new Promise((res, rej) => {
        const fd = fs.openSync(p, 'w');
        fs.write(fd, b, (e) => { fs.closeSync(fd); e ? rej(e) : res(); });
        s();
      }),
      'WriteStream before open': (p, b, s) => new Promise((res) => {
        const ws = fs.createWriteStream(p); ws.write(b); s(); ws.end(res);
      }),
      'WriteStream after open': (p, b, s) => new Promise((res) => {
        const ws = fs.createWriteStream(p);
        ws.on('open', () => { ws.write(b); s(); ws.end(res); });
      }),
    };
    const callerTick = ['WriteStream before open'];
    (async () => {
      let n = 0;
      for (const [entry, run] of Object.entries(entries)) {
        const after = 'w' + n++;
        const b = new Uint8Array([1, 2, 3]);
        await run(after, b, () => {});
        b.fill(9);
        await new Promise((r) => setImmediate(r));
        let line = entry + ' after completion ' + bytes(after);
        if (callerTick.includes(entry)) {
          const tick = 'w' + n++;
          const t = new Uint8Array([1, 2, 3]);
          await run(tick, t, () => t.fill(9));
          line += ' caller tick ' + bytes(tick);
        }
        console.log(line);
      }
      fs.writeFileSync('o', 'abc');
      const read = await fs.promises.readFile('o');
      read.fill(9);
      console.log('promises.readFile result mutated', fs.readFileSync('o', 'latin1'));
    })();
  `,
};

export default c;
