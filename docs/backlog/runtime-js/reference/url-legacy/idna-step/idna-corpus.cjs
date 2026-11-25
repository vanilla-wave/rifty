// Inputs: IdnaTestV2 sources + the 40 probe hosts. Output JSON [{src}] (unescaped).
'use strict';
const fs = require('node:fs');
const [idnaPath, probeIdna, out] = process.argv.slice(2);
const unesc = (s) =>
  s
    .replace(/\\u([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(Number.parseInt(h, 16)))
    .replace(/\\x\{([0-9A-Fa-f]+)\}/g, (_, h) => String.fromCodePoint(Number.parseInt(h, 16)));
const rows = [];
for (const line of fs.readFileSync(idnaPath, 'utf8').split('\n')) {
  if (!line || line.startsWith('#')) continue;
  rows.push({ set: 'idna', src: unesc(line.split(';')[0].trim()) });
}
// probe HOSTS array literal
const txt = fs.readFileSync(probeIdna, 'utf8');
const arr = txt.slice(
  txt.indexOf('const HOSTS = ['),
  txt.indexOf('];', txt.indexOf('const HOSTS = [')) + 1,
);
const HOSTS = Function(`return ${arr.replace('const HOSTS = ', '')}`)();
for (const h of HOSTS) rows.push({ set: 'probe', src: h });
fs.writeFileSync(out, JSON.stringify(rows));
console.log(rows.length, 'rows,', HOSTS.length, 'probe hosts');
