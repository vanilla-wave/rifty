// produceDependencySnapshot in plain Node over deps/ (requirements "Найдено дополнительно"):
//   node docs/backlog/distribution/reference/isolate-library-probe/produce-artifact.mjs <registryUrl> <out.tar.gz> [workbench dist/index.js]
// Installs the published @riftydev/workbench@0.11.0 into a temp dir (the repo's workbench dist
// imports workspace packages as TypeScript sources, which plain Node refuses:
// ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX), then writes a `profile: 'frozen'` gzip artifact. Feed it to
// `probe.mjs --deps-artifact <out.tar.gz>`.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [registryUrl, out, workbench] = process.argv.slice(2);
if (!registryUrl || !out) throw new Error('usage: produce-artifact.mjs <registryUrl> <out.tar.gz>');
const deps = join(dirname(fileURLToPath(import.meta.url)), 'deps');
const dir = mkdtempSync(join(tmpdir(), 'isolate-library-probe-wb-'));
let wb = workbench;
if (!wb) {
  writeFileSync(join(dir, 'package.json'), '{"private":true}');
  execFileSync('npm', ['install', '--no-audit', '--no-fund', '@riftydev/workbench@0.11.0'], {
    cwd: dir,
    stdio: 'ignore',
  });
  wb = join(dir, 'node_modules/@riftydev/workbench/dist/index.js');
}
const { produceDependencySnapshot } = await import(pathToFileURL(wb).href);
const t = performance.now();
const r = await produceDependencySnapshot({
  templateId: 'isolate-library-probe',
  packageJsonText: readFileSync(join(deps, 'package.json'), 'utf8'),
  packageLockText: readFileSync(join(deps, 'package-lock.json'), 'utf8'),
  registryUrl,
  profile: 'frozen',
});
writeFileSync(out, r.archive);
console.log(
  JSON.stringify({
    ms: Math.round(performance.now() - t),
    bytes: r.archive.byteLength,
    contentEncoding: r.contentEncoding,
    snapshotId: r.snapshotId,
    installArtifactIdentity: r.installArtifactIdentity,
  }),
);
rmSync(dir, { recursive: true, force: true });
