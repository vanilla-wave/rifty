/**
 * An original npm package tree as parity `setup.files`. The npm-authored v3 lock
 * picks the layout; each archive is the original registry tarball, checked
 * against the lock and the recorded SHA512 SRI + size, then unpacked by system
 * `tar` — no rifty code on the oracle's input path. Text-only trees: a file
 * that is not UTF-8 throws instead of being written lossy.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface ProvenanceEntry {
  readonly name: string;
  readonly version: string;
  readonly file: string;
  readonly tarball: string;
  readonly integrity: string;
  readonly bytes: number;
}

interface LockEntry {
  readonly version?: string;
  readonly resolved?: string;
  readonly integrity?: string;
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function readJson<T>(url: URL): T {
  return JSON.parse(readFileSync(url, 'utf8')) as T;
}

function collect(dir: string, prefix: string, files: Record<string, string>): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) collect(path, `${prefix}/${name}`, files);
    else files[`${prefix}/${name}`] = utf8.decode(readFileSync(path));
  }
}

/** `fixture` = directory holding `provenance.json`, `packages/` and `<tree>/package-lock.json`. */
export function npmTreeFiles(fixture: URL, tree: string): Record<string, string> {
  const { packages: provenance } = readJson<{ packages: ProvenanceEntry[] }>(
    new URL('provenance.json', fixture),
  );
  const lock = readJson<{ lockfileVersion: number; packages: Record<string, LockEntry> }>(
    new URL(`${tree}/package-lock.json`, fixture),
  );
  if (lock.lockfileVersion !== 3) throw new Error(`${tree}: expected an npm v3 lock`);
  const files: Record<string, string> = {};
  const scratch = mkdtempSync(join(tmpdir(), 'rifty-npm-tree-'));
  try {
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (path === '') continue;
      const name = path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
      const source = provenance.find((p) => p.name === name && p.version === entry.version);
      if (!source || source.tarball !== entry.resolved || source.integrity !== entry.integrity) {
        throw new Error(`${tree}: ${path} has no matching original archive`);
      }
      const archive = fileURLToPath(new URL(`packages/${source.file}.tgz`, fixture));
      const bytes = readFileSync(archive);
      const sri = `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
      if (sri !== source.integrity || bytes.byteLength !== source.bytes) {
        throw new Error(`${tree}: original npm archive drift ${name}@${source.version}`);
      }
      const out = join(scratch, source.file);
      mkdirSync(out);
      execFileSync('tar', ['-xzf', archive, '-C', out]);
      collect(join(out, 'package'), path, files);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return files;
}
