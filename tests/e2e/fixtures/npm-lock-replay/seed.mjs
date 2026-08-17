// e2e seeding helper: runs INSIDE the rifty shell (`node seed.mjs <origin>
// <fixture> <file...>`), fetching committed fixture files into the project cwd.
import { mkdirSync, writeFileSync } from 'node:fs';

const [origin, fixture, ...files] = process.argv.slice(2);
const base = `${origin}/__e2e-fixtures/npm-lock-replay/${fixture}/`;
for (const file of files) {
  const response = await fetch(base + file);
  if (!response.ok) throw new Error(`${file}: ${response.status}`);
  const dir = file.split('/').slice(0, -1).join('/');
  if (dir) mkdirSync(dir, { recursive: true });
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
}
console.log('SEED-OK');
