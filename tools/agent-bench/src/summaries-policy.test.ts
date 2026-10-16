import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { expect, it } from 'vitest';

const root = fileURLToPath(new URL('../reports/summaries/', import.meta.url));
const files = (await readdir(root, { recursive: true })).sort();
// Frozen evidence written by the measuring run (level 9, its host OS byte); SHA256 recorded in manifest.
const frozenBundle = 'source-artifacts.json.gz';
const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const gzipFiles = files.filter((file) => file.endsWith('.json.gz'));
const manifests = files.filter((file) => basename(file) === 'manifest.json.gz');

it('commits summary machine artifacts gzip-compressed only', async () => {
  expect(files.filter((file) => file.endsWith('.json'))).toEqual([]);
  const runs = (await readdir(root, { withFileTypes: true })).filter((entry) =>
    entry.isDirectory(),
  );
  expect(runs.length).toBeGreaterThan(0);
  expect(gzipFiles.filter((file) => basename(file) !== frozenBundle).length).toBeGreaterThan(0);
  expect(manifests.length).toBeGreaterThan(0);
  for (const run of runs) expect(files).toContain(join(run.name, 'report.json.gz'));
});

it.each(gzipFiles)(
  'keeps gzip JSON and report-written OS header valid: %s',
  async (file) => {
    // RFC 1952 byte 9 = host OS; pinned 0x03 for JSON the repo writes. Frozen bundles keep recorded bytes.
    const bad: string[] = [];
    const bytes = await readFile(join(root, file));
    if (basename(file) !== frozenBundle && bytes[9] !== 0x03)
      bad.push(`${file}: OS byte 0x${bytes[9]!.toString(16)}`);
    try {
      JSON.parse(gunzipSync(bytes).toString('utf8'));
    } catch (error) {
      bad.push(`${file}: ${(error as Error).message}`);
    }
    expect(bad).toEqual([]);
  },
  60_000,
);

type Manifest = {
  bundle: { path: string; bytes: number; sha256: string };
  files: { run: string; kind: string; bytes: number; sha256: string; committed: string | null }[];
};

it.each(manifests)(
  'keeps manifest-recorded size and SHA256 exact: %s',
  async (file) => {
    const bad: string[] = [];
    const dir = join(root, dirname(file));
    const manifest = JSON.parse(
      gunzipSync(await readFile(join(root, file))).toString('utf8'),
    ) as Manifest;
    const bundle = await readFile(join(dir, manifest.bundle.path));
    if (sha256(bundle) !== manifest.bundle.sha256 || bundle.length !== manifest.bundle.bytes)
      bad.push(`${file}: bundle ${manifest.bundle.path} is ${sha256(bundle)}`);
    // Bundle entries hold each original file as parsed JSON; originals were 2-space JSON.
    const entries = new Map(
      (JSON.parse(gunzipSync(bundle).toString('utf8')) as Record<string, unknown>[]).map(
        (entry) => [entry.id, entry],
      ),
    );
    for (const record of manifest.files) {
      if (record.committed === null) continue;
      const bytes =
        record.committed === manifest.bundle.path
          ? JSON.stringify(entries.get(record.run)?.[record.kind], null, 2)
          : await readFile(join(dir, record.committed)).catch(() => undefined);
      if (
        bytes === undefined ||
        sha256(bytes) !== record.sha256 ||
        Buffer.byteLength(bytes) !== record.bytes
      )
        bad.push(`${file}: ${record.run} ${record.kind} -> ${record.committed}`);
    }
    expect(bad).toEqual([]);
  },
  60_000,
);

it('keeps summary markdown links resolvable', async () => {
  const broken: string[] = [];
  for (const file of files.filter((file) => file.endsWith('.md')))
    for (const [, target] of (await readFile(join(root, file), 'utf8')).matchAll(
      /\]\(([^)#\s]+)\)/g,
    ))
      if (!/^[a-z]+:/i.test(target!) && !existsSync(join(root, dirname(file), target!)))
        broken.push(`${file} -> ${target}`);
  expect(broken).toEqual([]);
});

// Committed summaries carry the text core only (ADR-0532): Markdown, gzip JSON and PNG screens;
// browser traces, split parts, workspace archives and anything above the frozen-bundle ceiling stay local.
it('commits only text-core files below the size ceiling', async () => {
  const ceiling = 8 * 1024 * 1024;
  const bad: string[] = [];
  for (const file of files) {
    const info = await stat(join(root, file));
    if (info.isDirectory()) continue;
    if (!/\.(md|json\.gz|png)$/u.test(file) || /(^|\/)browser\./u.test(file))
      bad.push(`${file}: not a text-core file`);
    if (info.size > ceiling) bad.push(`${file}: ${info.size} bytes`);
  }
  expect(bad).toEqual([]);
});

// The producer report of a frozen campaign never changes after its recording (ADR-0532 §2).
const frozenReports: Record<string, string> = {
  '2026-10-15-eval-v18-corrected/report.json.gz':
    '25e93c3bf98210b029d100594db3f90bb7aaaf38092e2909bd54f5efd0a6f56f',
};
it.each(Object.entries(frozenReports))(
  'keeps the frozen producer report exact: %s',
  async (file, digest) => {
    expect(sha256(await readFile(join(root, file)))).toBe(digest);
  },
);
