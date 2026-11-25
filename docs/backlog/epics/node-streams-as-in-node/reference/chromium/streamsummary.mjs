// rows.jsonl -> summary.txt: median ms (and ticks) per route x case x MiB, against Node; sha256 vs Node.
import { readFileSync, writeFileSync } from 'node:fs';
const [rowsPath, outPath, header] = process.argv.slice(2);
const rows = readFileSync(rowsPath, 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l));
const median = (xs) => {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : null;
};
const keys = [...new Set(rows.map((r) => `${r.case}|${r.mib}`))];
const routes = ['node', ...new Set(rows.filter((r) => r.route !== 'node').map((r) => r.route))];
const lines = [
  header,
  `case | MiB | ${routes.map((r) => `${r} median ms (ticks) [runs, sha=node, exits]`).join(' | ')}`,
];
for (const k of keys) {
  const [c, mib] = k.split('|');
  const nodeSha = rows.find(
    (r) => r.route === 'node' && r.case === c && String(r.mib) === mib,
  )?.sha256;
  const cells = routes.map((route) => {
    const rs = rows.filter((r) => r.route === route && r.case === c && String(r.mib) === mib);
    if (!rs.length) return `${route}: not run`;
    const shaOk = rs.every((r) => r.sha256 === nodeSha)
      ? 'yes'
      : rs.map((r) => (r.sha256 === nodeSha ? 'y' : 'NO')).join('/');
    const exits = [...new Set(rs.map((r) => r.exit))].join(',');
    return `${median(rs.map((r) => r.ms))} (${median(rs.map((r) => r.ticks))}) [${rs.length}, ${shaOk}, ${exits}]`;
  });
  lines.push(`${c} | ${mib} | ${cells.join(' | ')}`);
}
writeFileSync(outPath, `${lines.join('\n')}\n`);
console.log(lines.join('\n'));
