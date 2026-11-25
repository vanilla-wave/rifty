// Step 7b: callback zlib.inflate of a corrupt buffer reports its error.
const zlib = require('node:zlib');
const { readFileSync } = require('node:fs');

zlib.inflate(readFileSync('in/corrupt.zz'), (err, out) => {
  if (!err) return console.log(`inflated ${out.length}`);
  const { name, message, code, errno } = err;
  console.log(JSON.stringify({ error: err instanceof Error, name, message, code, errno }));
});
