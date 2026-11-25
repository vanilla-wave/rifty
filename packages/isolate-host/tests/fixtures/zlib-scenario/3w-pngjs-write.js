// Step 3w: pngjs PNG.sync.write (`new PNG()` creates a deflate stream, then deflateSync).
const { writeOut } = require('./lib.js');
const { PNG } = require('pngjs');
const paint = require('./image.js');

writeOut('out.png', PNG.sync.write(paint(new PNG({ width: 300, height: 200 }))));
