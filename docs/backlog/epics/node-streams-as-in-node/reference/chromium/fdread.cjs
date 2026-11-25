// fd read probe: node fdread.cjs setup|fdread|readsync|readfilesync <MiB>
// (copied as run; the setup branch now exits with process.exit, a top-level return before)
const fs = require('node:fs');
const [mode, mibS] = process.argv.slice(2);
const mib = Number(mibS);
const p = `big-${mib}.bin`;
const N = mib * 1048576;
if (mode === 'setup') {
  fs.writeFileSync(p, Buffer.alloc(N, 0x61));
  console.log(JSON.stringify({ mode, mib, size: fs.statSync(p).size }));
  process.exit(0);
}
let ticks = 0;
const iv = setInterval(() => ticks++, 1);
const t0 = performance.now();
const done = (bytes, extra = {}) => {
  const ms = performance.now() - t0;
  clearInterval(iv);
  console.log(JSON.stringify({ mode, mib, bytes, ms: Math.round(ms), ticks, ...extra }));
};
if (mode === 'fdread') {
  fs.open(p, 'r', (e, fd) => {
    if (e) throw e;
    const buf = Buffer.alloc(65536);
    let total = 0;
    let reads = 0;
    const step = () =>
      fs.read(fd, buf, 0, 65536, null, (e2, n) => {
        if (e2) throw e2;
        if (n === 0) return fs.close(fd, () => done(total, { reads }));
        total += n;
        reads++;
        step();
      });
    step();
  });
} else if (mode === 'readsync') {
  const fd = fs.openSync(p, 'r');
  const buf = Buffer.alloc(65536);
  let total = 0;
  for (
    let n = fs.readSync(fd, buf, 0, 65536, null);
    n > 0;
    n = fs.readSync(fd, buf, 0, 65536, null)
  )
    total += n;
  fs.closeSync(fd);
  done(total);
} else if (mode === 'readfilesync') {
  done(fs.readFileSync(p).length);
} else throw new Error(`mode ${mode}`);
