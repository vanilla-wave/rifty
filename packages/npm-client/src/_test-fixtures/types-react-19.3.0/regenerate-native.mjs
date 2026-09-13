import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
const npmCli = await realpath(execFileSync('which', ['npm'], { encoding: 'utf8' }).trim());
const require = createRequire(join(dirname(dirname(npmCli)), 'package.json'));
const pacote = require('pacote');
const npm = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim();
const pacoteVersion = require('pacote/package.json').version;
if (npm !== '11.17.0' || pacoteVersion !== '21.5.1')
  throw new Error(`Expected npm11.17.0/pacote21.5.1; got ${npm}/${pacoteVersion}`);
const root = new URL('./', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'));
const bytes = await readFile(new URL('package.tgz', root));
if (`sha512-${createHash('sha512').update(bytes).digest('base64')}` !== manifest.dist.integrity)
  throw new Error('Original tarball integrity mismatch');
const dest = await mkdtemp(join(tmpdir(), 'rifty-npm-types-oracle-'));
await pacote.extract(new URL('package.tgz', root).pathname, dest);
const entries = {};
async function walk(path) {
  for (const entry of await readdir(join(dest, path), { withFileTypes: true })) {
    const name = path ? `${path}/${entry.name}` : entry.name;
    if (entry.isDirectory()) await walk(name);
    else if (entry.isFile()) {
      const bytes = await readFile(join(dest, name));
      entries[name] = {
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    }
  }
}
await walk('');
await writeFile(
  new URL('native-oracle.json', root),
  `${JSON.stringify({ node: process.version, npm, pacote: pacoteVersion, entries }, null, 2)}\n`,
);
console.log(`Native npm oracle: ${Object.keys(entries).length} files`);
