const fs = require('node:fs');
const path = require('node:path');
const out = {};
const walk = (p) =>
  fs.readdirSync(p).flatMap((n) => {
    const c = path.join(p, n);
    return fs.statSync(c).isDirectory() ? [`${c}/`, ...walk(c)] : [c];
  });
out.skeleton = ROOT === '/' ? walk('/') : null;
const d = path.join(ROOT, 'w');
fs.mkdirSync(d, { recursive: true });
try {
  fs.writeFileSync(path.join(d, 'lone\uD800'), 'x');
  out.lone = fs.readdirSync(d).map((n) => [...n].map((c) => c.charCodeAt(0).toString(16)));
} catch (e) {
  out.lone = String(e);
}
for (const n of ['b', 'B', 'a', '_', 'é', 'Z', '\u{1F600}', 'a b', 'new\nline'])
  fs.writeFileSync(path.join(d, n), n);
out.order = fs
  .readdirSync(d)
  .map((n) => JSON.stringify(n))
  .join(',');
const f = path.join(d, 'a');
const s0 = fs.statSync(f);
fs.readFileSync(f);
const s1 = fs.statSync(f);
out.atimeChangedByRead = s0.atimeMs !== s1.atimeMs;
fs.utimesSync(f, 1000.123456, 2000.987654);
const s2 = fs.statSync(f);
out.utimes = [s2.atimeMs, s2.mtimeMs, s2.ctimeMs > 2000000];
out.mode = [s2.mode.toString(8), fs.statSync(d).mode.toString(8)];
for (const op of [
  () => fs.symlinkSync('a', path.join(d, 'ln')),
  () => fs.chmodSync(f, 0o755),
  () => fs.linkSync(f, path.join(d, 'hl')),
]) {
  try {
    op();
    out[op.toString().slice(9, 20)] =
      `ok mode=${fs.statSync(f).mode.toString(8)} lstatLink=${fs.existsSync(path.join(d, 'ln')) && fs.lstatSync(path.join(d, 'ln')).isSymbolicLink()}`;
  } catch (e) {
    out[op.toString().slice(9, 20)] = `${e.code} ${e.message.split('\n')[0]}`;
  }
}
const dirBefore = fs.statSync(d).mtimeMs;
fs.writeFileSync(path.join(d, 'zz'), '');
out.dirMtimeBumped = fs.statSync(d).mtimeMs !== dirBefore;
const r = fs.readFileSync(f);
out.readBuffer = [r.byteLength, r.buffer.byteLength];
console.log(JSON.stringify(out, null, 1));
