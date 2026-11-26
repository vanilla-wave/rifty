import type { ParityCase } from '../../src/types.ts';

/**
 * When an async fs API reads its options, as Node v24.16.0's JS layer does (`lib/fs.js`,
 * `lib/internal/fs/promises.js`): each API × option field × options-object shape (plain, a class
 * instance, the field on the prototype, a non-enumerable field, a getter counting its reads) ×
 * the field changed right after the call. Printed: the outcome and, for the getter, how many
 * times each field was read. Stable by construction (the reads are synchronous at the call or
 * after a fixed step). Then a `Buffer` path changed after the call (a `URL` is the in-process runner's Node class; the
 * isolate has none), and the arities (`fs.rmdir`/`cp`/`utimes`/`lutimes` are missing:
 * `runtime-js/fs-module-export-list`).
 */
const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    const { Buffer } = require('node:buffer');
    let n = 0;
    const fresh = () => 'o' + (n++);
    const shapes = {
      plain: (f) => ({ ...f }),
      class: (f) => Object.assign(new (class O {})(), f),
      proto: (f) => Object.create(f),
      hidden: (f) => Object.defineProperties({}, Object.fromEntries(Object.entries(f).map(([k, v]) => [k, { value: v, writable: true, enumerable: false }]))),
      getter: (f) => {
        const store = { ...f };
        const reads = {};
        const o = {};
        for (const k of Object.keys(f)) Object.defineProperty(o, k, { enumerable: true, get: () => { reads[k] = (reads[k] || 0) + 1; return store[k]; }, set: (v) => { store[k] = v; } });
        Object.defineProperty(o, '__reads', { value: reads });
        return o;
      },
    };
    const outcome = (e, v) => (e ? (e.code || e.message) : v === undefined ? 'ok' : typeof v === 'string' ? JSON.stringify(v) : Buffer.isBuffer(v) ? 'buffer ' + v.toString('hex') : Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : 'dirent ' + x.name)).join('+') : typeof v);
    // [name, fields, change, start(options, done, fresh name)]
    const rows = [
      ['writeFile flag', { flag: 'a' }, { flag: 'w' }, (o, done, f) => { fs.writeFileSync(f, 'old'); fs.writeFile(f, 'new', o, (e) => done(e, fs.readFileSync(f, 'utf8'))); }],
      ['promises.writeFile flag', { flag: 'a' }, { flag: 'w' }, (o, done, f) => { fs.writeFileSync(f, 'old'); fs.promises.writeFile(f, 'new', o).then(() => done(null, fs.readFileSync(f, 'utf8')), done); }],
      ['writeFile encoding', { encoding: 'hex' }, { encoding: 'utf8' }, (o, done, f) => { fs.writeFile(f, '6162', o, (e) => done(e, fs.readFileSync(f, 'utf8'))); }],
      ['promises.writeFile encoding', { encoding: 'hex' }, { encoding: 'utf8' }, (o, done, f) => { fs.promises.writeFile(f, '6162', o).then(() => done(null, fs.readFileSync(f, 'utf8')), done); }],
      ['appendFile flag', { flag: 'w' }, { flag: 'a' }, (o, done, f) => { fs.writeFileSync(f, 'old'); fs.appendFile(f, 'new', o, (e) => done(e, fs.readFileSync(f, 'utf8'))); }],
      ['promises.appendFile encoding', { encoding: 'hex' }, { encoding: 'utf8' }, (o, done, f) => { fs.promises.appendFile(f, '6162', o).then(() => done(null, fs.readFileSync(f, 'utf8')), done); }],
      ['readFile flag', { flag: 'r' }, { flag: 'w+' }, (o, done, f) => { fs.writeFileSync(f, 'keep'); fs.readFile(f, o, (e) => done(e, fs.readFileSync(f, 'utf8'))); }],
      ['promises.readFile flag', { flag: 'r' }, { flag: 'w+' }, (o, done, f) => { fs.writeFileSync(f, 'keep'); fs.promises.readFile(f, o).then(() => done(null, fs.readFileSync(f, 'utf8')), done); }],
      ['readFile encoding', { encoding: 'utf8' }, { encoding: 'hex' }, (o, done, f) => { fs.writeFileSync(f, 'ab'); fs.readFile(f, o, done); }],
      ['promises.readFile encoding', { encoding: 'utf8' }, { encoding: 'hex' }, (o, done, f) => { fs.writeFileSync(f, 'ab'); fs.promises.readFile(f, o).then((v) => done(null, v), done); }],
      ['readdir withFileTypes', { withFileTypes: false }, { withFileTypes: true }, (o, done, f) => { fs.mkdirSync(f); fs.writeFileSync(f + '/x', ''); fs.readdir(f, o, done); }],
      ['promises.readdir withFileTypes', { withFileTypes: false }, { withFileTypes: true }, (o, done, f) => { fs.mkdirSync(f); fs.writeFileSync(f + '/x', ''); fs.promises.readdir(f, o).then((v) => done(null, v), done); }],
      ['mkdir recursive', { recursive: false }, { recursive: true }, (o, done, f) => { fs.mkdir(f + '/a/b', o, (e) => done(e, fs.existsSync(f + '/a/b') ? 'made' : 'none')); }],
      ['promises.mkdir recursive', { recursive: false }, { recursive: true }, (o, done, f) => { fs.promises.mkdir(f + '/a/b', o).then(() => done(null, 'made'), done); }],
      ['rm recursive', { recursive: false }, { recursive: true }, (o, done, f) => { fs.mkdirSync(f + '/d', { recursive: true }); fs.rm(f, o, (e) => done(null, (e ? e.code + ' ' : '') + (fs.existsSync(f) ? 'kept' : 'removed'))); }],
      ['promises.rm recursive', { recursive: false }, { recursive: true }, (o, done, f) => { fs.mkdirSync(f + '/d', { recursive: true }); fs.promises.rm(f, o).then(() => done(null, 'removed'), (e) => done(null, e.code + ' ' + (fs.existsSync(f) ? 'kept' : 'removed'))); }],
      ['rm force', { force: false }, { force: true }, (o, done, f) => { fs.rm(f, o, done); }],
      ['stat throwIfNoEntry', { throwIfNoEntry: true }, { throwIfNoEntry: false }, (o, done, f) => { fs.stat(f, o, done); }],
      ['promises.stat throwIfNoEntry', { throwIfNoEntry: true }, { throwIfNoEntry: false }, (o, done, f) => { fs.promises.stat(f, o).then((v) => done(null, v), done); }],
      ['realpath encoding', { encoding: 'utf8' }, { encoding: 'buffer' }, (o, done, f) => { fs.writeFileSync(f, ''); fs.realpath(f, o, (e, v) => done(e, v === undefined ? v : typeof v === 'string' ? 'string' : 'buffer')); }],
      ['promises.realpath encoding', { encoding: 'utf8' }, { encoding: 'buffer' }, (o, done, f) => { fs.writeFileSync(f, ''); fs.promises.realpath(f, o).then((v) => done(null, typeof v === 'string' ? 'string' : 'buffer'), done); }],
    ];
    const run = ([name, base, change, start], shape) => new Promise((resolve) => {
      const f = fresh();
      const o = shapes[shape](base);
      start(o, (e, v) => {
        const reads = o.__reads ? ' reads ' + JSON.stringify(o.__reads) : '';
        resolve(name + ' [' + shape + '] => ' + outcome(e, v) + reads);
      }, f);
      Object.assign(o, change);
    });
    (async () => {
      for (const row of rows) for (const shape of Object.keys(shapes)) console.log(await run(row, shape));
      fs.writeFileSync('pa', 'A');
      fs.writeFileSync('pb', 'B');
      const bufferPath = Buffer.from('pa');
      const r1 = new Promise((r) => fs.readFile(bufferPath, 'utf8', (e, v) => r(e ? e.code : v)));
      bufferPath.write('pb');
      console.log('readFile, Buffer path changed after the call => ' + (await r1));
      const arity = (o, names) => names.map((k) => k + '=' + o[k].length).join(' ');
      console.log('arity ' + arity(fs, ['readFile', 'writeFile', 'appendFile', 'readdir', 'mkdir', 'rm', 'unlink', 'stat', 'lstat', 'fstat', 'readlink', 'realpath', 'access', 'copyFile', 'rename', 'truncate', 'ftruncate', 'mkdtemp', 'opendir', 'futimes', 'open', 'close', 'read', 'write']));
      console.log('arity promises ' + arity(fs.promises, ['readFile', 'writeFile', 'appendFile', 'readdir', 'mkdir', 'rm', 'rmdir', 'unlink', 'stat', 'lstat', 'readlink', 'realpath', 'access', 'copyFile', 'rename', 'cp', 'truncate', 'mkdtemp', 'opendir', 'utimes', 'lutimes']));
    })();
  `,
};

export default c;
