// Order-of-magnitude speed: 64 MiB pushed in 64 KiB chunks through a PassThrough into a Writable, and
// 1e5 one-byte writes to a Writable with a synchronous callback. Median of 5, ms.
const { Readable, PassThrough, Writable, pipeline } = require('node:stream');
const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
const chunk = Buffer.alloc(65536, 1);
const pipeOnce = () =>
  new Promise((res, rej) => {
    let n = 0;
    const t0 = performance.now();
    const src = new Readable({
      read() {
        this.push(n++ < 1024 ? chunk : null);
      },
    });
    pipeline(
      src,
      new PassThrough(),
      new Writable({
        write(_c, _e, cb) {
          cb();
        },
      }),
      (e) => (e ? rej(e) : res(performance.now() - t0)),
    );
  });
const writesOnce = () =>
  new Promise((res) => {
    const t0 = performance.now();
    const w = new Writable({
      write(_c, _e, cb) {
        cb();
      },
    });
    for (let i = 0; i < 1e5; i++) w.write('x');
    w.end(() => res(performance.now() - t0));
  });
(async () => {
  const p = [];
  const w = [];
  for (let i = 0; i < 5; i++) {
    p.push(await pipeOnce());
    w.push(await writesOnce());
  }
  console.log(`pipe 64 MiB ms ${Math.round(med(p))}`);
  console.log(`1e5 writes ms ${Math.round(med(w))}`);
})();
