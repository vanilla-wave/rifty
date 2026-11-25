// Step 3r: pngjs PNG.sync.read of step 3w's file (`zlib.Inflate.call(this)` + `_processChunk`).
const { readFileSync } = require('node:fs');
const { sha } = require('./lib.js');
const { PNG } = require('pngjs');
const paint = require('./image.js');

const back = PNG.sync.read(readFileSync('in/out.png'));
const want = paint(new PNG({ width: 300, height: 200 }));
console.log(
  `read ${back.width}x${back.height} ${back.data.length} ${sha(back.data)} roundTrip=${Buffer.compare(back.data, want.data) === 0}`,
);
