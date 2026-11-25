// fd I/O scaling on one host: for 1/4/16 MiB, a 64 KiB-chunk readSync loop, a writeSync loop on a new
// file, positional writeSync into the middle, against readFileSync/writeFileSync; median of 3, ms.
const fs = require('node:fs');
const path = require('node:path');
const C = 65536;
const med = (a) => a.sort((x, y) => x - y)[1];
const time = (f) => {
  const t = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    f();
    t.push(performance.now() - t0);
  }
  return Math.round(med(t));
};
for (const mib of [1, 4, 16]) {
  const N = mib * 1048576;
  const f = path.join(__dirname, `s-${mib}.bin`);
  const data = Buffer.alloc(N, 0x61);
  fs.writeFileSync(f, data);
  const buf = Buffer.alloc(C);
  const readLoop = time(() => {
    const fd = fs.openSync(f, 'r');
    while (fs.readSync(fd, buf, 0, C, null) > 0);
    fs.closeSync(fd);
  });
  const readFile = time(() => fs.readFileSync(f));
  const w = path.join(__dirname, `w-${mib}.bin`);
  const writeLoop = time(() => {
    const fd = fs.openSync(w, 'w');
    for (let o = 0; o < N; o += C) fs.writeSync(fd, data, o, C, null);
    fs.closeSync(fd);
  });
  const positional = time(() => {
    const fd = fs.openSync(f, 'r+');
    for (let k = 0; k < N / C; k++) fs.writeSync(fd, buf, 0, C, ((k * 7919) % (N / C)) * C);
    fs.closeSync(fd);
  });
  const writeFile = time(() => fs.writeFileSync(w, data));
  console.log(
    `${mib} MiB => readSync loop ${readLoop} | readFileSync ${readFile} | writeSync loop ${writeLoop} | positional ${positional} | writeFileSync ${writeFile}`,
  );
}
