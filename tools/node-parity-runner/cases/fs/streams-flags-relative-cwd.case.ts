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
    })();
  `,
};

export default c;
