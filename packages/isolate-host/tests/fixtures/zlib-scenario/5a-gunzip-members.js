// Step 5a: gunzipSync of a two-member .gz.
const zlib = require('node:zlib');
const { readFileSync } = require('node:fs');

console.log(JSON.stringify(zlib.gunzipSync(readFileSync('in/two-members.gz')).toString('utf8')));
