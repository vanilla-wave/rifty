// fs.read/readSync argument errors vs Node. Setup: p.txt = 'abcdefghij' in cwd.
// Run: as a parity case (code below) — pnpm test:parity <case>; output in parity-diff.txt
const fs = require('node:fs');
const fd = fs.openSync('p.txt', 'r');
const b = Buffer.alloc(4);
const t = (l, f) => {
  try {
    console.log(l, f());
  } catch (e) {
    console.log(l, 'throws', e.name, e.code, e.message);
  }
};
t('1 offset -1', () => fs.readSync(fd, b, -1, 2, 0));
t('1 length past buffer', () => fs.readSync(fd, b, 0, 9, 0));
t('2 string offset', () => fs.readSync(fd, b, '1', 2, 0));
t('3 length 1.5', () => fs.readSync(fd, b, 0, 1.5, 0));
t('4 two invalid', () => fs.readSync(fd, b, -1, 0, 'x'));
t('4 async two invalid', () => fs.read(fd, b, -1, 0, 'x', () => {}));
t('5 async bounds', () => fs.read(fd, b, 0, 9, 0, (e) => console.log('5 cb', e && e.code)));
t('6 stdin zero pos 1', () =>
  fs.read(0, b, 0, 0, 1, (e, n) => console.log('6 cb', e && e.code, n)),
);
t('6 stdin zero offset past', () =>
  fs.read(0, b, 9, 0, null, (e, n) => console.log('6b cb', e && e.code, n)),
);
const wo = fs.openSync('wo.txt', 'w');
t('7 write-only past buffer', () => fs.readSync(wo, b, 0, 9, 0));
fs.closeSync(wo);
t('7 closed past buffer', () => fs.readSync(wo, b, 0, 9, 0));
