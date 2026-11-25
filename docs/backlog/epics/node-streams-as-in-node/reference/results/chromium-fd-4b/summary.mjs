import { readFileSync } from 'node:fs';
const rows = readFileSync(process.argv[2], 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l))
  .filter((r) => r.mode && r.guest);
const g = new Map();
for (const r of rows) {
  const k = `${r.persistence ?? r.host} ${r.mode} ${r.mib}`;
  (g.get(k) ?? g.set(k, []).get(k)).push(r.guest.ms);
}
for (const [k, v] of g) {
  const s = [...v].sort((a, b) => a - b);
  console.log(k.padEnd(34), 'median', s[Math.floor(s.length / 2)], 'runs', v.join('/'));
}
