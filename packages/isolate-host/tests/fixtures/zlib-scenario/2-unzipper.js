// Step 2: unzipper lists and extracts step 1's xlsx: Open.buffer and a piped Parse (createInflateRaw).
const { readFileSync } = require('node:fs');
const { Readable } = require('node:stream');
const { sha } = require('./lib.js');
const unzipper = require('unzipper');

(async () => {
  const xlsx = readFileSync('in/out.xlsx');
  const dir = await unzipper.Open.buffer(xlsx);
  for (const f of dir.files) {
    const b = await f.buffer();
    console.log(`open ${f.path} ${b.length} ${sha(b)}`);
  }
  const pending = [];
  await new Promise((resolve, reject) => {
    Readable.from([xlsx.subarray(0, 7000), xlsx.subarray(7000)])
      .pipe(unzipper.Parse())
      .on('entry', (e) =>
        pending.push(
          (async () => {
            const c = [];
            for await (const x of e) c.push(x);
            const b = Buffer.concat(c);
            return `parse ${e.path} ${b.length} ${sha(b)}`;
          })(),
        ),
      )
      .on('close', resolve)
      .on('error', reject);
  });
  for (const line of await Promise.all(pending)) console.log(line);
})();
