// An ordinary run 2: what an agent's next program does.
const fs = require('node:fs');
const r = {};
try {
  fs.mkdirSync('/workspace/a/b/c', { recursive: true });
  r.mkdirP = 'ok';
} catch (e) {
  r.mkdirP = e.code;
}
try {
  fs.writeFileSync('/workspace/a/x.bin', Buffer.from([9, 8, 7]));
  r.rw =
    Buffer.compare(fs.readFileSync('/workspace/a/x.bin'), Buffer.from([9, 8, 7])) === 0
      ? 'ok'
      : 'diff';
} catch (e) {
  r.rw = e.code;
}
try {
  const s = fs.statSync('/workspace/a/x.bin');
  r.stat = s.isFile() && s.size === 3 ? 'ok' : 'bad';
} catch (e) {
  r.stat = e.code;
}
try {
  r.readdir = fs.readdirSync('/workspace/a').join(',');
} catch (e) {
  r.readdir = e.code;
}
try {
  require('pdf-lib');
  r.require = 'ok';
} catch (e) {
  r.require = String(e.message).slice(0, 60);
}
r.pwnedSeen = typeof {}.__pwned;
console.log(JSON.stringify(r));
