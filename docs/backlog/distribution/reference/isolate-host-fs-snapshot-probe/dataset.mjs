// Build a template-scale dataset from real files: walk real dirs under .pnpm/*/node_modules, skip symlinks.
import { readdirSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [root, targetFiles, targetBytes, out] = [process.argv[2], Number(process.argv[3]), Number(process.argv[4]), process.argv[5]];
const files = []; const dirs = []; let bytes = 0;
function walk(abs, rel) {
  if (files.length >= targetFiles || bytes >= targetBytes) return;
  dirs.push(rel);
  for (const name of readdirSync(abs).sort()) {
    const a = join(abs, name), r = `${rel}/${name}`;
    const st = lstatSync(a);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walk(a, r);
    else if (st.isFile()) { if (files.length >= targetFiles || bytes >= targetBytes) return; if (st.size > 100000) continue; const d = readFileSync(a); files.push([r, d]); bytes += d.length; }
  }
}
const pnpm = join(root, 'node_modules/.pnpm');
for (const pkg of readdirSync(pnpm).sort()) {
  const nm = join(pnpm, pkg, 'node_modules');
  let names; try { names = readdirSync(nm); } catch { continue; }
  for (const n of names) {
    const scoped = n.startsWith('@') ? readdirSync(join(nm, n)).map((s) => `${n}/${s}`) : [n];
    for (const s of scoped) { const a = join(nm, s); if (lstatSync(a).isSymbolicLink()) continue; walk(a, `/workspace/node_modules/${s}`); }
  }
  if (files.length >= targetFiles || bytes >= targetBytes) break;
}
// pack: u32 jsonLen, json {files:[[path,size]], dirs}, data
const meta = Buffer.from(JSON.stringify({ files: files.map(([p, d]) => [p, d.length]), dirs: [...new Set(dirs)] }));
const head = Buffer.alloc(4); head.writeUInt32LE(meta.length);
writeFileSync(out, Buffer.concat([head, meta, ...files.map(([, d]) => d)]));
console.log(JSON.stringify({ files: files.length, dirs: new Set(dirs).size, bytes }));
