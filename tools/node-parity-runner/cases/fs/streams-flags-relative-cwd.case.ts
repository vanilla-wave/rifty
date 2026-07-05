import type { ParityCase } from '../../src/types.ts';

/**
 * `createReadStream`/`createWriteStream` contract the review 2026-07-05 found
 * broken: (1) write-stream `flags` were silently ignored — `{flags:'a'}`
 * OVERWROTE the file (logger data loss) and `wx` never raised EEXIST;
 * (2) both factories skipped cwd resolution — `createReadStream('data.txt')`
 * at cwd `/app` read `/data.txt` (the accidental-root trap `ParityCase.cwd`
 * exists to expose); (3) stream error events carried raw VfsErrors without
 * errno/syscall. Runs at a non-root cwd so every relative path is load-bearing.
 */
const c: ParityCase = {
  cwd: '/app',
  setup: {
    files: {
      'app/data.txt': 'from-app',
      'app/log.txt': 'line0\n',
      'app/exists.txt': 'keep',
      'app/plain.txt': 'x',
    },
  },
  code: `
    const fs = require('node:fs');

    const finished = (s) => new Promise((res, rej) => {
      s.on('finish', res);
      s.on('error', rej);
    });
    const errored = (s) => new Promise((res) => s.on('error', res));

    (async () => {
      // (2) relative read honors cwd
      const readBack = await new Promise((res, rej) => {
        let out = '';
        const rs = fs.createReadStream('data.txt', { encoding: 'utf8' });
        rs.on('data', (c) => { out += c; });
        rs.on('end', () => res(out));
        rs.on('error', rej);
      });
      console.log('read-relative:', readBack);

      // (1) append flag appends, twice
      for (const line of ['line1', 'line2']) {
        const ws = fs.createWriteStream('log.txt', { flags: 'a' });
        ws.end(line + '\\n');
        await finished(ws);
      }
      console.log('append:', JSON.stringify(fs.readFileSync('log.txt', 'utf8')));

      // (1) exclusive flag raises EEXIST as an error EVENT with Node shape
      const wx = fs.createWriteStream('exists.txt', { flags: 'wx' });
      const e1 = await errored(wx);
      console.log('wx-exists:', e1.code, e1.errno, e1.syscall, JSON.stringify(e1.path));
      console.log('wx-untouched:', fs.readFileSync('exists.txt', 'utf8'));

      // (1b) r+ must strict-preflight through-file paths as ENOTDIR, not
      // collapse existsSync(false) into ENOENT.
      const rplusNotDir = fs.createWriteStream('plain.txt/deep', { flags: 'r+' });
      const e1b = await errored(rplusNotDir);
      console.log('rplus-notdir:', e1b.code, e1b.errno, e1b.syscall, JSON.stringify(e1b.path));

      // truncate-at-open: 'w' with no writes empties the file once finished
      const wtrunc = fs.createWriteStream('exists.txt');
      wtrunc.end();
      await finished(wtrunc);
      console.log('w-truncates:', JSON.stringify(fs.readFileSync('exists.txt', 'utf8')));

      // (2) relative write honors cwd — visible via relative readFileSync
      const ws2 = fs.createWriteStream('out.txt');
      ws2.write('first,');
      ws2.end('second');
      await finished(ws2);
      console.log('write-relative:', fs.readFileSync('out.txt', 'utf8'));

      // (3) read-stream miss is a Node-shaped error event
      const rs2 = fs.createReadStream('nope.txt');
      const e2 = await errored(rs2);
      console.log('read-missing:', e2.code, e2.errno, e2.syscall, JSON.stringify(e2.path));

      // (4) callback overloads (review 2026-07-05 fix round): end(cb) fires the
      // callback and writes NO stray bytes (a function in the chunk slot used
      // to overlay as array-like -> NUL byte); write(chunk, cb) takes cb, not
      // an encoding.
      const ws3 = fs.createWriteStream('cb.txt');
      ws3.write('hello');
      await new Promise((res) => ws3.end(res));
      console.log('end-cb:', JSON.stringify(fs.readFileSync('cb.txt', 'utf8')));
      const ws4 = fs.createWriteStream('cb2.txt');
      const werr = await new Promise((res) => ws4.write('x', res));
      await new Promise((res) => ws4.end(res));
      console.log('write-cb:', werr === undefined || werr === null,
        JSON.stringify(fs.readFileSync('cb2.txt', 'utf8')));

      const ws5 = fs.createWriteStream('after-end.txt');
      await new Promise((res, rej) => {
        ws5.on('ready', res);
        ws5.on('error', rej);
      });
      const ws5Closed = new Promise((res) => ws5.on('close', res));
      const writeAfterEndEvent = new Promise((res) => ws5.on('error', res));
      ws5.end('a');
      const writeAfterEndRet = ws5.write('b', () => {});
      const e3 = await writeAfterEndEvent;
      await ws5Closed;
      console.log('write-after-end-same-tick:', writeAfterEndRet, e3.code,
        JSON.stringify(fs.readFileSync('after-end.txt', 'utf8')));

      // (5) encoding never splits a multibyte char across chunk boundaries
      fs.writeFileSync('euro.txt', 'a\u20acb');
      const chunks = [];
      await new Promise((res, rej) => {
        const rs3 = fs.createReadStream('euro.txt', { encoding: 'utf8', highWaterMark: 1 });
        rs3.on('data', (c) => chunks.push(c));
        rs3.on('end', res);
        rs3.on('error', rej);
      });
      console.log('multibyte:', JSON.stringify(chunks.join('|')));
    })();
  `,
};

export default c;
