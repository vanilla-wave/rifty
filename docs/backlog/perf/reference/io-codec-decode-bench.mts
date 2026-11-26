// usage: npx tsx io-codec-decode-bench.mts <repo>  — bytesToString vs Node Buffer#toString, 13 MiB, min of 3 (ms)
const root = process.argv[2];
const { bytesToString } = await import(`${root}/packages/io/src/index.ts`);
const { Buffer: NB } = await import('node:buffer');
const n = 13 * 1024 * 1024;
const bytes = new Uint8Array(n);
for (let i = 0; i < n; i++) bytes[i] = (i * 7919) & 0xff;
const nb = NB.from(bytes.buffer);
const t = (f: () => unknown) => {
  f();
  const r: number[] = [];
  for (let i = 0; i < 3; i++) {
    const s = performance.now();
    f();
    r.push(performance.now() - s);
  }
  return Math.min(...r).toFixed(1);
};
for (const enc of ['hex', 'base64', 'base64url', 'latin1', 'ascii', 'utf16le', 'utf8']) {
  console.log(
    enc.padEnd(10),
    'rifty',
    t(() => bytesToString(bytes, enc)).padStart(8),
    'ms   node',
    t(() => nb.toString(enc as BufferEncoding)).padStart(7),
    'ms',
  );
}
