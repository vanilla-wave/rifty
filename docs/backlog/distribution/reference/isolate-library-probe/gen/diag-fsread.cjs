// node diag-fsread.cjs: reading a file through fs.createReadStream (exceljs xlsx.read / csv.read /
// readFile stop here), one line each; its own file, as a stream 'error' without a listener ends the
// run. The error line keeps the frame names below it.
const fs = require('node:fs');
const frames = (e) =>
  (e.stack || '')
    .split('\n')
    .slice(1, 5)
    .map((l) =>
      l
        .trim()
        .replace(/^at /, '')
        .replace(/ \(.*$/, ''),
    )
    .join(' < ');
fs.writeFileSync('t.txt', 'abc');
const s = fs.createReadStream('t.txt');
console.log(
  `typeof fs.createReadStream()[Symbol.asyncIterator]: ${typeof s[Symbol.asyncIterator]}`,
);
const chunks = [];
s.on('data', (c) => chunks.push(c));
s.on('end', () => console.log(`fs.createReadStream 'data': ${Buffer.concat(chunks)}`));
s.on('error', (e) =>
  console.log(`fs.createReadStream 'error': ${e.name}: ${e.message} [${frames(e)}]`),
);
