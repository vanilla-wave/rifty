import type { ParityCase } from '../../src/types.ts';

// Every encoded fs read keeps a leading UTF-8 BOM in Node (sync, callback,
// promises, createReadStream incl. a BOM split across chunks); so
// JSON.parse of a BOM'd file throws there, unlike require() (modules guards).
const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    const { Buffer } = require('node:buffer');
    const cps = (s) => s.length + ':' + [...s].map((ch) => ch.codePointAt(0).toString(16)).join(' ');
    fs.writeFileSync('bom.txt', Buffer.from([0xef, 0xbb, 0xbf, 0x41]));
    fs.writeFileSync('bom.json', Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]));
    fs.writeFileSync('bom16.txt', Buffer.from([0xff, 0xfe, 0x41, 0x00]));
    console.log('sync', cps(fs.readFileSync('bom.txt', 'utf8')));
    console.log('sync-opts', cps(fs.readFileSync('bom.txt', { encoding: 'utf-8' })));
    console.log('sync-utf16le', cps(fs.readFileSync('bom16.txt', 'utf16le')));
    console.log('sync-latin1', cps(fs.readFileSync('bom.txt', 'latin1')));
    try {
      JSON.parse(fs.readFileSync('bom.json', 'utf8'));
      console.log('json-parse', 'ok');
    } catch (err) {
      console.log('json-parse', err.name);
    }
    const streamText = (opts) =>
      new Promise((resolve, reject) => {
        let out = '';
        const s = fs.createReadStream('bom.txt', opts);
        s.on('data', (chunk) => { out += chunk; });
        s.on('error', reject);
        s.on('end', () => resolve(out));
      });
    fs.readFile('bom.txt', 'utf8', async (err, cb) => {
      if (err) throw err;
      console.log('callback', cps(cb));
      console.log('promises', cps(await fs.promises.readFile('bom.txt', 'utf8')));
      console.log('stream', cps(await streamText({ encoding: 'utf8' })));
      console.log('stream-split', cps(await streamText({ encoding: 'utf8', highWaterMark: 1 })));
    });
  `,
};

export default c;
