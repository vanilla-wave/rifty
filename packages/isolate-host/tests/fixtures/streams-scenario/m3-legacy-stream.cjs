// Node's chain Readable/Writable -> Stream -> EventEmitter: instanceof Stream, inherited Stream.prototype.pipe.
const fs = require('node:fs');
const path = require('node:path');
const s = require('node:stream');
const E = require('node:events');
const e2s = (e) =>
  e ? `${e.code ? `${e.code}:` : ''}${String(e.message).split('\n')[0].slice(0, 60)}` : String(e);
const rows = [];
const row = (name, fn) => rows.push([name, fn]);
const settle = (ms = 30) => new Promise((r) => setTimeout(r, ms));
row('prototype chain', async (L) => {
  L.push(
    ['Readable', 'Writable', 'Duplex', 'Transform', 'PassThrough']
      .map((k) => `${k}:${Object.getPrototypeOf(s[k].prototype) === s.Stream.prototype}`)
      .join(' '),
    `Stream->EE:${Object.getPrototypeOf(s.Stream.prototype) === E.prototype}`,
  );
});
row('instanceof Stream', async (L) => {
  L.push(
    new s.Readable() instanceof s.Stream,
    new s.Writable() instanceof s.Stream,
    new s.PassThrough() instanceof s,
    Object.getPrototypeOf(s.Readable) === s.Stream,
  );
});
row('fs streams instanceof Stream', async (L) => {
  const f = path.join(__dirname, 'l.txt');
  fs.writeFileSync(f, 'l');
  const rs = fs.createReadStream(f);
  const ws = fs.createWriteStream(path.join(__dirname, 'l.out'));
  L.push(rs instanceof s.Stream, ws instanceof s.Stream);
  rs.destroy();
  ws.destroy();
});
row('Stream.prototype.pipe is the legacy pipe', async (L) => {
  L.push(typeof s.Stream.prototype.pipe, s.Writable.prototype.pipe === s.Stream.prototype.pipe);
});
(async () => {
  for (const [name, fn] of rows) {
    const L = [];
    try {
      await Promise.race([fn(L), settle(3000).then(() => L.push('no settle in 3s'))]);
    } catch (e) {
      L.push(`threw ${e2s(e)}`);
    }
    await settle();
    console.log(`${name} => ${L.join(',')}`);
  }
})();
let uncaught = 0;
process.on('uncaughtException', (e) => console.log(`uncaught ${++uncaught} => ${e2s(e)}`));
