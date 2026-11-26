// graceful-fs 4.2.11 (exceljs closure, via fstream): its ReadStream/WriteStream call fs.*Stream.apply(this).
const path = require('node:path');
const e2s = (e) =>
  `${e?.name}${e?.code ? ` [${e.code}]` : ''}: ${String(e?.message).split('\n')[0].slice(0, 100)}`;
const gfs = require('graceful-fs');
const f = path.join(__dirname, 'g.txt');
try {
  const ws = gfs.createWriteStream(f);
  ws.on('close', () => {
    try {
      let s = '';
      gfs
        .createReadStream(f)
        .on('data', (c) => {
          s += c;
        })
        .on('end', () => console.log('read', JSON.stringify(s)));
    } catch (e) {
      console.log('createReadStream threw', e2s(e));
    }
  });
  ws.end('graceful\n');
} catch (e) {
  console.log('createWriteStream threw', e2s(e));
}
