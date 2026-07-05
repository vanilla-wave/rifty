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

      const shared = fs.createWriteStream('log.txt', { flags: 'a' });
      await new Promise((res, rej) => {
        shared.on('ready', res);
        shared.on('error', rej);
      });
      await new Promise((res) => shared.write('line3\\n', res));
      fs.appendFileSync('log.txt', 'line4\\n');
      await new Promise((res) => shared.end('line5\\n', res));
      console.log('append-shared-writer:', JSON.stringify(fs.readFileSync('log.txt', 'utf8')));

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

      const queuedSuccessEvents = [];
      const ws4b = fs.createWriteStream('queued-success.txt');
      ws4b.on('open', () => queuedSuccessEvents.push('open'));
      ws4b.on('ready', () => queuedSuccessEvents.push('ready'));
      ws4b.on('finish', () => queuedSuccessEvents.push('finish'));
      ws4b.on('close', () => queuedSuccessEvents.push('close'));
      ws4b.write('x', (e) => queuedSuccessEvents.push('writecb:' + (e?.code ?? 'null')));
      ws4b.end((e) => queuedSuccessEvents.push('endcb:' + (e?.code ?? 'null')));
      await new Promise((res) => ws4b.on('close', res));
      console.log('queued-success-order:', queuedSuccessEvents.join('|'));

      const ws5 = fs.createWriteStream('after-end.txt');
      await new Promise((res, rej) => {
        ws5.on('ready', res);
        ws5.on('error', rej);
      });
      const ws5Closed = new Promise((res) => ws5.on('close', res));
      const writeAfterEndEvents = [];
      ws5.on('error', (e) => writeAfterEndEvents.push('error:' + e.code));
      ws5.end('a', (e) => writeAfterEndEvents.push('endcb:' + e.code));
      const writeAfterEndRet = ws5.write('b', (e) =>
        writeAfterEndEvents.push('writecb:' + e.code));
      await ws5Closed;
      console.log('write-after-end-same-tick:', writeAfterEndRet,
        writeAfterEndEvents.join('|'),
        JSON.stringify(fs.readFileSync('after-end.txt', 'utf8')));

      const writeEndWriteEvents = [];
      const ws5a = fs.createWriteStream('write-end-write.txt');
      await new Promise((res, rej) => {
        ws5a.on('ready', res);
        ws5a.on('error', rej);
      });
      const writeEndWriteClosed = new Promise((res) => ws5a.on('close', res));
      ws5a.on('error', (e) => writeEndWriteEvents.push('error:' + e.code));
      ws5a.write('a', (e) => writeEndWriteEvents.push('write1cb:' + e.code));
      ws5a.end((e) => writeEndWriteEvents.push('endcb:' + e.code));
      const writeEndWriteRet = ws5a.write('b', (e) =>
        writeEndWriteEvents.push('write2cb:' + e.code));
      await writeEndWriteClosed;
      console.log('write-end-write-same-tick:', writeEndWriteRet,
        writeEndWriteEvents.join('|'),
        JSON.stringify(fs.readFileSync('write-end-write.txt', 'utf8')));

      const preOpenEvents = [];
      const ws5b = fs.createWriteStream('after-end-preopen.txt');
      ws5b.on('open', () => preOpenEvents.push('open'));
      ws5b.on('ready', () => preOpenEvents.push('ready'));
      ws5b.on('error', (e) => preOpenEvents.push('error:' + e.code));
      ws5b.on('close', () => preOpenEvents.push('close'));
      const preOpenClosed = new Promise((res) => ws5b.on('close', res));
      ws5b.end((e) => preOpenEvents.push('endcb:' + e.code));
      const writeAfterEndPreOpenRet = ws5b.write('b', (e) =>
        preOpenEvents.push('cb:' + e.code));
      preOpenEvents.push('ret:' + writeAfterEndPreOpenRet);
      await preOpenClosed;
      console.log('write-after-end-preopen:', preOpenEvents.join('|'),
        JSON.stringify(fs.readFileSync('after-end-preopen.txt', 'utf8')));

      const preOpenFailEvents = [];
      const ws5c = fs.createWriteStream('missing-dir/after-end-preopen.txt');
      ws5c.on('open', () => preOpenFailEvents.push('open'));
      ws5c.on('ready', () => preOpenFailEvents.push('ready'));
      ws5c.on('error', (e) => preOpenFailEvents.push('error:' + e.code));
      ws5c.on('close', () => preOpenFailEvents.push('close'));
      const preOpenFailClosed = new Promise((res) => ws5c.on('close', res));
      ws5c.end((e) => preOpenFailEvents.push('endcb:' + e.code));
      const preOpenFailRet = ws5c.write('b', (e) =>
        preOpenFailEvents.push('cb:' + e.code));
      preOpenFailEvents.push('ret:' + preOpenFailRet);
      await preOpenFailClosed;
      console.log('write-after-end-preopen-fail:', preOpenFailEvents.join('|'));

      const destroyPreOpenEvents = [];
      const ws5d = fs.createWriteStream('destroy-preopen.txt');
      ws5d.on('open', () => destroyPreOpenEvents.push('open'));
      ws5d.on('ready', () => destroyPreOpenEvents.push('ready'));
      ws5d.on('error', (e) => destroyPreOpenEvents.push('error:' + e.code));
      ws5d.on('close', () => destroyPreOpenEvents.push('close'));
      const destroyPreOpenClosed = new Promise((res) => ws5d.on('close', res));
      ws5d.write('a', (e) => destroyPreOpenEvents.push('writecb:' + e.code));
      ws5d.end((e) => destroyPreOpenEvents.push('endcb:' + e.code));
      ws5d.destroy();
      await destroyPreOpenClosed;
      console.log('destroy-preopen:', destroyPreOpenEvents.join('|'),
        JSON.stringify(fs.readFileSync('destroy-preopen.txt', 'utf8')));

      const destroyPostOpenEvents = [];
      const ws5e = fs.createWriteStream('destroy-postopen.txt');
      ws5e.on('open', () => destroyPostOpenEvents.push('open'));
      ws5e.on('ready', () => destroyPostOpenEvents.push('ready'));
      ws5e.on('error', (e) => destroyPostOpenEvents.push('error:' + e.code));
      ws5e.on('close', () => destroyPostOpenEvents.push('close'));
      await new Promise((res, rej) => {
        ws5e.on('ready', res);
        ws5e.on('error', rej);
      });
      const destroyPostOpenClosed = new Promise((res) => ws5e.on('close', res));
      ws5e.write('a', (e) => destroyPostOpenEvents.push('writecb:' + e.code));
      ws5e.destroy();
      await destroyPostOpenClosed;
      console.log('destroy-postopen-write:', destroyPostOpenEvents.join('|'));

      const destroyEndPostOpenEvents = [];
      const ws5f = fs.createWriteStream('destroy-end-postopen.txt');
      ws5f.on('open', () => destroyEndPostOpenEvents.push('open'));
      ws5f.on('ready', () => destroyEndPostOpenEvents.push('ready'));
      ws5f.on('error', (e) => destroyEndPostOpenEvents.push('error:' + e.code));
      ws5f.on('close', () => destroyEndPostOpenEvents.push('close'));
      await new Promise((res, rej) => {
        ws5f.on('ready', res);
        ws5f.on('error', rej);
      });
      const destroyEndPostOpenClosed = new Promise((res) => ws5f.on('close', res));
      ws5f.end((e) => destroyEndPostOpenEvents.push('endcb:' + e.code));
      ws5f.destroy();
      await destroyEndPostOpenClosed;
      console.log('destroy-postopen-end:', destroyEndPostOpenEvents.join('|'));

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
