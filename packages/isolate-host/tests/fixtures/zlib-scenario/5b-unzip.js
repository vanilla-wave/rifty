// Step 5b: zlib.unzip of gzip and of zlib input.
const zlib = require('node:zlib');
const { readFileSync } = require('node:fs');
const { sha } = require('./lib.js');

zlib.unzip(readFileSync('in/text.gz'), (err, gz) => {
  if (err) throw err;
  console.log(`gzip ${gz.length} ${sha(gz)}`);
  zlib.unzip(readFileSync('in/text.zz'), (err2, zz) => {
    if (err2) throw err2;
    console.log(`zlib ${zz.length} ${sha(zz)}`);
  });
});
