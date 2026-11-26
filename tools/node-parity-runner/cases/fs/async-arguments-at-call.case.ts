import type { ParityCase } from '../../src/types.ts';

/**
 * What an async fs call fixes at the call, as Node: a callback form's options, its path (a
 * `Buffer` path as its string) and read options — a promise form reads its options as it
 * goes; a callback that is not a function throws
 * there (`makeCallback`), `fs.rm` checks its options there. Stable by construction in Node
 * (the call copies or validates synchronously); v24.16.0 240/240.
 */
const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    const { Buffer } = require('node:buffer');
    fs.writeFileSync('a.txt', 'abc');
    fs.writeFileSync('b.txt', 'xyz');
    const show = (name, f) => {
      try {
        f();
        console.log(name + ' => no throw');
      } catch (e) {
        console.log(name + ' => ' + e.code + ': ' + e.message);
      }
    };
    const fd = fs.openSync('a.txt', 'r');
    const noCb = {
      readFile: () => fs.readFile('a.txt'),
      'readFile(opts, "x")': () => fs.readFile('a.txt', {}, 'x'),
      writeFile: () => fs.writeFile('w.txt', 'd'),
      appendFile: () => fs.appendFile('w.txt', 'd', null),
      open: () => fs.open('a.txt', 'r'),
      read: () => fs.read(fd, Buffer.alloc(1), 0, 1, 0, 'cb'),
      write: () => fs.write(fd, 'x', 0, 'utf8', 42),
      stat: () => fs.stat('a.txt', null),
      lstat: () => fs.lstat('a.txt'),
      fstat: () => fs.fstat(fd),
      readdir: () => fs.readdir('.'),
      mkdir: () => fs.mkdir('m', {}),
      unlink: () => fs.unlink('nope'),
      rename: () => fs.rename('nope', 'nope2'),
      copyFile: () => fs.copyFile('a.txt', 'c.txt'),
      access: () => fs.access('a.txt'),
      readlink: () => fs.readlink('a.txt'),
      realpath: () => fs.realpath('a.txt'),
      truncate: () => fs.truncate('w.txt', 0),
      ftruncate: () => fs.ftruncate(fd, 0),
      mkdtemp: () => fs.mkdtemp('t-'),
      opendir: () => fs.opendir('.', 7),
      futimes: () => fs.futimes(fd, 1, 2),
      'rm(path, null)': () => fs.rm('b.txt', null),
      'rmSync(path, null)': () => fs.rmSync('b.txt', null),
      'rm(123, cb)': () => fs.rm(123, () => {}),
      'opendirSync bufferSize 0': () => fs.opendirSync('.', { bufferSize: 0 }),
      'opendirSync bufferSize -1': () => fs.opendirSync('.', { bufferSize: -1 }),
      'opendirSync bufferSize 2.5': () => fs.opendirSync('.', { bufferSize: 2.5 }),
      "opendirSync bufferSize '4'": () => fs.opendirSync('.', { bufferSize: '4' }),
      'rm(path, { force: "x" })': () => fs.rm('b.txt', { force: 'x' }, () => {}),
    };
    for (const [name, f] of Object.entries(noCb)) show(name, f);
    console.log('b.txt kept => ' + fs.existsSync('b.txt'));
    // One at a time: the completion order of ops in flight together is Node's threadpool's.
    const later = [];
    const settle = (name, run) => later.push(() => new Promise((r) => run(r)).then((v) => console.log(name + ' => ' + v)));
    settle('writeFile, options.flag changed after the call', (r) => {
      fs.writeFileSync('f.txt', 'old');
      const opts = { flag: 'a' };
      fs.writeFile('f.txt', 'new', opts, () => r(fs.readFileSync('f.txt', 'utf8')));
      opts.flag = 'w';
    });
    settle('readFile, options.encoding changed after the call', (r) => {
      const opts = { encoding: 'utf8' };
      fs.readFile('a.txt', opts, (e, v) => r(typeof v === 'string' ? v : 'bytes ' + Buffer.from(v).toString('hex')));
      opts.encoding = 'hex';
    });
    // Node's promise form reads its options as it goes: the change shows.
    settle('promises.readFile, options.encoding changed after the call', (r) => {
      const opts = { encoding: 'utf8' };
      fs.promises.readFile('a.txt', opts).then((v) => r(v));
      opts.encoding = 'hex';
    });
    // The fd is checked before the loud bigint gap (Node: EBADF).
    settle('fstat(bad fd, { bigint: true })', (r) => fs.fstat(9999, { bigint: true }, (e) => r(e ? e.code : 'ok')));
    settle('readFile, Buffer path changed after the call', (r) => {
      const p = Buffer.from('a.txt');
      fs.readFile(p, 'utf8', (e, v) => r(e ? e.code : v));
      p.write('b');
    });
    settle('read, options.position changed after the call', (r) => {
      const buf = Buffer.alloc(2);
      const opts = { offset: 0, length: 2, position: 0 };
      fs.read(fd, buf, opts, () => r(buf.toString()));
      opts.position = 1;
    });
    (async () => {
      for (const run of later) await run();
      fs.closeSync(fd);
    })();
  `,
};

export default c;
