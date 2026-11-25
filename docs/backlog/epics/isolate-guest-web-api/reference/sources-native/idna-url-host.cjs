// WHATWG host parsing (`new URL('http://' + h + '/').hostname`) over Unicode IdnaTestV2 sources:
// Node's URL (ada) vs whatwg-url's (tr46, CheckBidi per the URL spec).
// Usage: node idna-url-host.cjs <IdnaTestV2.txt> <dir holding node_modules/whatwg-url>
'use strict';
const { readFileSync } = require('node:fs');
const { URL: WURL } = require(require.resolve('whatwg-url', { paths: [process.argv[3]] }));

const unescape = (s) =>
  s
    .replace(/\\x\{([0-9A-Fa-f]+)\}/g, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/\\u([0-9A-Fa-f]{4})/g, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)));
const sources = new Set();
for (const line of readFileSync(process.argv[2], 'utf8').split('\n')) {
  const body = line.split('#')[0].trim();
  if (!body) continue;
  const src = unescape(body.split(';')[0].trim());
  if (src) sources.add(src);
}
const host = (Ctor, h) => {
  try {
    return new Ctor(`http://${h}/`).hostname;
  } catch {
    return '<throws>';
  }
};
let total = 0;
let idn = 0;
let differ = 0;
let differIdn = 0;
const examples = [];
for (const h of sources) {
  total++;
  const isIdn = [...h].some((c) => c.codePointAt(0) > 0x7f) || /(^|\.)xn--/i.test(h);
  if (isIdn) idn++;
  const a = host(URL, h);
  const b = host(WURL, h);
  if (a !== b) {
    differ++;
    if (isIdn) differIdn++;
    if (examples.length < 12) examples.push(`${JSON.stringify(h)} node=${a} whatwg-url=${b}`);
  }
}
console.log(
  `node ${process.version} ada ${process.versions.ada} unicode ${process.versions.unicode}; whatwg-url ${require(require.resolve('whatwg-url/package.json', { paths: [process.argv[3]] })).version}`,
);
console.log(`sources ${total}, non-ASCII or xn-- ${idn}`);
console.log(`differ ${differ} (non-ASCII/xn-- ${differIdn})`);
for (const e of examples) console.log(`  ${e}`);
