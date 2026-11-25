// Shared by the steps: frozen clock (zip entry dates, xlsx/pdf timestamps) and the output report.
const { createHash } = require('node:crypto');
const { writeFileSync } = require('node:fs');

const T0 = 1_700_000_000_000;
const RealDate = Date;
global.Date = class extends RealDate {
  constructor(...a) {
    super(...(a.length ? a : [T0]));
  }
  static now() {
    return T0;
  }
};
const sha = (b) => createHash('sha256').update(b).digest('hex');
/** Writes `out/<name>` and prints its size and sha256. */
function writeOut(name, bytes) {
  writeFileSync(`out/${name}`, bytes);
  console.log(`out/${name} ${bytes.length} ${sha(bytes)}`);
}
module.exports = { sha, writeOut };
