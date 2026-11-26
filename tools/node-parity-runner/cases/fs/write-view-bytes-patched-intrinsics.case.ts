import type { ParityCase } from '../../src/types.ts';

/**
 * A write reads a view's bytes as Node does when the program patched a shared
 * intrinsic (`%TypedArray%.prototype.subarray`/`byteLength`, global
 * `Uint8Array`/`DataView`/`ArrayBuffer`). In-process and isolate only: on the
 * browser hosts the store transport reads through those intrinsics too
 * (declared: backlog runtime-js/post-guest-paths-use-replaceable-intrinsics).
 * `patchesSharedRealm`: the patches span async writes in the runner's own realm.
 */
const c: ParityCase = {
  patchesSharedRealm: true,
  code: `
    const fs = require('node:fs');
    const U = Uint8Array;
    const TA = Object.getPrototypeOf(U.prototype);
    const patch = (obj, key, desc, run) => {
      const old = Object.getOwnPropertyDescriptor(obj, key);
      Object.defineProperty(obj, key, { configurable: true, ...('value' in desc ? { writable: true } : {}), ...desc });
      const restore = () => { if (old) Object.defineProperty(obj, key, old); else delete obj[key]; };
      let out;
      try { out = run(); } catch (e) { restore(); throw e; }
      return Promise.resolve(out).finally(restore);
    };
    const views = {
      'subarray patched': () => [new U([1, 2, 3]), (run) => patch(TA, 'subarray', { value: function () { return this; } }, run)],
      'byteLength getter patched': () => [new U([1, 2, 3]), (run) => patch(TA, 'byteLength', { get() { return 1; } }, run)],
      'global Uint8Array replaced': () => [new U([1, 2, 3]), (run) => patch(globalThis, 'Uint8Array', { value: function () { throw new Error('guest Uint8Array called'); } }, run)],
      'global DataView/ArrayBuffer replaced': () => [new U([1, 2, 3]), (run) => patch(globalThis, 'ArrayBuffer', { value: function () { throw new Error('guest ArrayBuffer called'); } }, () => patch(globalThis, 'DataView', { value: function () { throw new Error('guest DataView called'); } }, run))],
    };
    const show = (p) => { try { return Array.from(fs.readFileSync(p)).join(',') || 'empty'; } catch (e) { return 'read ' + e.code; } };
    const entries = {
      writeFileSync: (p, v) => fs.writeFileSync(p, v),
      appendFileSync: (p, v) => fs.appendFileSync(p, v),
      'promises.writeFile': (p, v) => fs.promises.writeFile(p, v),
      'writeFile cb': (p, v) => new Promise((res, rej) => fs.writeFile(p, v, (e) => (e ? rej(e) : res()))),
      'promises.appendFile': (p, v) => fs.promises.appendFile(p, v),
      writeSync: (p, v) => { const fd = fs.openSync(p, 'w'); try { fs.writeSync(fd, v); } finally { fs.closeSync(fd); } },
      'write cb': (p, v) => new Promise((res, rej) => { const fd = fs.openSync(p, 'w'); fs.write(fd, v, (e) => { fs.closeSync(fd); e ? rej(e) : res(); }); }),
      WriteStream: (p, v) => new Promise((res, rej) => { const ws = fs.createWriteStream(p); ws.on('error', rej); ws.end(v, res); }),
    };
    (async () => {
      let n = 0;
      for (const [vn, make] of Object.entries(views)) {
        const row = [];
        for (const [en, write] of Object.entries(entries)) {
          const p = 'v' + n++;
          const [v, around = (run) => run()] = make();
          try {
            await around(() => write(p, v));
            try { v.fill(9); } catch {}
            row.push(en + '=' + show(p));
          } catch (e) { row.push(en + '=' + e.name + ':' + (e.code || e.message)); }
        }
        console.log(vn, row.join(' '));
      }
    })();
  `,
};

export default c;
