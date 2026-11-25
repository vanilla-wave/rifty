// Node v24.16.0's legacy-parser toASCII (`url.parse(...).hostname`, ada::idna) vs tr46 with
// WHATWG domain-to-ASCII flags minus CheckBidi. Usage: node idna.cjs <dir holding node_modules/tr46>
'use strict';
const tr46 = require(require.resolve('tr46', { paths: [process.argv[2]] }));
const url = require('node:url');
process.removeAllListeners('warning');
process.on('warning', () => {});
const FLAGS = {
  checkBidi: false,
  checkHyphens: false,
  checkJoiners: true,
  useSTD3ASCIIRules: false,
  transitionalProcessing: false,
  verifyDNSLength: false,
  ignoreInvalidPunycode: false,
};
const HOSTS = [
  // Unicode 17.0 letters (Node v24.16.0: ada 3.4.4, process.versions.unicode 17.0)
  '\u{10940}.com',
  '\u{11DB0}.com',
  '\u{16EA0}.com',
  '\u{1E6C0}.com',
  '\u{323B0}.com',
  'ñ.com',
  'faß.de',
  'xn--ida.com',
  'xn--',
  'xn--abc-.com',
  'a_b.com',
  'FOO.Com',
  'a..b',
  '-a.com',
  'a-.com',
  'ab--c.com',
  'a­.com',
  'ＡＢＣ.com',
  '例え.テスト',
  'xn--r8jz45g.xn--zckzah',
  'ß',
  'ẞ',
  '👍.com',
  'a‍b.com',
  'ا1.com',
  'xn--a.com',
  'xn--zz.com',
  'a.b.c.',
  'a。b',
  'Ⅷ.com',
  'ǅ.com',
  'x́.com',
  'א.com',
  'aא.com',
  'xn--ls8h.la',
  'i̇.com',
  'σ.com',
  'ς.com',
  'ـ.com',
  'xn--dmin-moa0i.com',
];
const result = (f) => {
  try {
    const v = f();
    return v === null || v === '' ? 'ERR_INVALID_URL' : v;
  } catch (e) {
    return e.code;
  }
};
let differ = 0;
for (const h of HOSTS) {
  const node = result(() => url.parse(`http://${h}/`).hostname);
  const js = result(() => tr46.toASCII(h.toLowerCase(), FLAGS));
  if (node !== js) differ++;
  console.log(node === js ? '=' : '≠', JSON.stringify(h), node, js);
}
console.log(
  `tr46 ${require(require.resolve('tr46/package.json', { paths: [process.argv[2]] })).version}: ${differ}/${HOSTS.length} differ`,
);
