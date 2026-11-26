// fs stream paths given as file: URLs (the core's toPathIfFileURL over the `url` binding).
const fs = require('node:fs');
for (const [k, u] of [
  ['space', 'file:///tmp/a%20b'],
  ['host', 'file://host/x'],
  ['encoded slash', 'file:///a%2Fb'],
  ['unicode', 'file:///t/%C3%A9'],
  ['http', 'http://x/'],
  ['localhost', 'file://localhost/etc/x'],
]) {
  try {
    const s = fs.createReadStream(new URL(u));
    s.on('error', () => {});
    console.log(`${k} => ${JSON.stringify(s.path)}`);
    s.destroy();
  } catch (e) {
    console.log(`${k} => ${e.name}|${e.code}|${e.message}`);
  }
}
