import type { ParityCase } from '../../src/types.ts';

/**
 * A write reads a view's bytes as Node does, whatever the view's own shape: the
 * memory through the engine (a patched `slice`, species, an own `length` change
 * nothing), `buffer`/`byteOffset`/`byteLength` where the entry's Node source
 * reads them (lib/fs: `byteLength` only; fs/promises and streams: all three); a
 * detached or out-of-bounds view writes nothing. Patched shared intrinsics:
 * `write-view-bytes-patched-intrinsics`.
 */
const c: ParityCase = {
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
      'detached': () => { const a = new ArrayBuffer(4); const v = new U(a); a.transfer(); return [v]; },
      'out of bounds': () => { const a = new ArrayBuffer(4, { maxByteLength: 8 }); const v = new U(a, 2, 2); a.resize(1); return [v]; },
      'length-tracking': () => { const a = new ArrayBuffer(2, { maxByteLength: 8 }); const v = new U(a); a.resize(3); v.set([1, 2, 3]); return [v]; },
      'slice patched': () => [new U([1, 2, 3]), (run) => patch(U.prototype, 'slice', { value: function () { return this; } }, run)],
      'species returns source': () => { const v = new U([1, 2, 3]); v.constructor = { [Symbol.species]: function () { return v; } }; return [v]; },
      'own buffer/byteOffset': () => { const v = new U([1, 2, 3]); Object.defineProperty(v, 'byteOffset', { value: 2 }); Object.defineProperty(v, 'buffer', { value: new ArrayBuffer(8) }); return [v]; },
      'own byteLength 1': () => { const v = new U([1, 2, 3]); Object.defineProperty(v, 'byteLength', { value: 1 }); return [v]; },
      'DataView own buffer/byteOffset': () => { const v = new DataView(new U([1, 2, 3]).buffer); Object.defineProperty(v, 'byteOffset', { value: 1 }); Object.defineProperty(v, 'buffer', { value: new ArrayBuffer(8) }); return [v]; },
      'own length': () => { const v = new U([1, 2, 3]); Object.defineProperty(v, 'length', { value: 1 }); return [v]; },
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
