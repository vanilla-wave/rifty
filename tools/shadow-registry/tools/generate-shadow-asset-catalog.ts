import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { canonicalJson } from '../src/install-artifact-recipe.ts';
import { downloadCatalogTarball, gunzipCatalogTarball } from './catalog-artifact-io.ts';

const execFile = promisify(execFileCallback);
const policyUrl = new URL('../esbuild-runtime-policy.json', import.meta.url);
const outputUrl = new URL('../generated/shadow-asset-catalog.json', import.meta.url);
const CATALOG_FETCH_STALL_MS = 10_000;

interface RuntimePolicy {
  readonly version: string;
  readonly source: Readonly<{
    package: string;
    version: string;
    integrity: string;
    maxTarballBytes: number;
    maxUnpackedBytes: number;
  }>;
  readonly wasm: Readonly<{ member: string; sha256: string; bytes: number }>;
}

interface NpmViewResult {
  readonly 'dist.tarball': string;
  readonly 'dist.integrity': string;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function readString(bytes: Uint8Array, offset: number, length: number): string {
  const field = bytes.subarray(offset, offset + length);
  const nul = field.indexOf(0);
  return new TextDecoder('utf-8', { fatal: true }).decode(
    nul === -1 ? field : field.subarray(0, nul),
  );
}

function exactMember(tar: Uint8Array, member: string): Uint8Array {
  let offset = 0;
  let found: Uint8Array | null = null;
  while (offset + 512 <= tar.byteLength) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const prefix = readString(header, 345, 155);
    const name = `${prefix}${prefix ? '/' : ''}${readString(header, 0, 100)}`;
    const rawSize = readString(header, 124, 12).trim();
    if (rawSize !== '' && !/^[0-7]+$/.test(rawSize)) throw new Error('catalog tar size drift');
    const size = rawSize === '' ? 0 : Number.parseInt(rawSize, 8);
    const bodyStart = offset + 512;
    const next = bodyStart + Math.ceil(size / 512) * 512;
    if (bodyStart + size > tar.byteLength || next > tar.byteLength) {
      throw new Error('catalog tarball is truncated');
    }
    const type = String.fromCharCode(header[156] ?? 0);
    if (name === member) {
      if (type !== '0' && type !== '\u0000') throw new Error(`${member} is not a regular file`);
      if (found) throw new Error(`duplicate ${member}`);
      found = tar.subarray(bodyStart, bodyStart + size).slice();
    }
    offset = next;
  }
  if (!found) throw new Error(`missing ${member}`);
  return found;
}

async function npmMetadata(name: string, version: string): Promise<NpmViewResult> {
  const { stdout } = await execFile(
    'npm',
    ['view', `${name}@${version}`, 'dist.tarball', 'dist.integrity', '--json'],
    { maxBuffer: 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout) as NpmViewResult;
  if (typeof parsed['dist.tarball'] !== 'string' || typeof parsed['dist.integrity'] !== 'string') {
    throw new Error('npm metadata omitted exact tarball facts');
  }
  return parsed;
}

async function buildCatalog(): Promise<unknown> {
  const policy = JSON.parse(await readFile(policyUrl, 'utf8')) as RuntimePolicy;
  if (policy.source.version !== policy.version) throw new Error('policy source version drift');
  const metadata = await npmMetadata(policy.source.package, policy.source.version);
  if (metadata['dist.integrity'] !== policy.source.integrity) {
    throw new Error('npm tarball integrity drifted from policy');
  }
  const tarball = await downloadCatalogTarball(metadata['dist.tarball'], {
    maxBytes: policy.source.maxTarballBytes,
    stallTimeoutMs: CATALOG_FETCH_STALL_MS,
  });
  const actualSri = `sha512-${createHash('sha512').update(tarball).digest('base64')}`;
  if (actualSri !== policy.source.integrity)
    throw new Error('downloaded tarball failed pinned SRI');
  const tar = await gunzipCatalogTarball(tarball, {
    maxBytes: policy.source.maxUnpackedBytes,
  });
  const member = exactMember(tar, policy.wasm.member);
  if (
    tarball.byteLength !== policy.source.maxTarballBytes ||
    tar.byteLength !== policy.source.maxUnpackedBytes ||
    member.byteLength !== policy.wasm.bytes ||
    sha256(member) !== policy.wasm.sha256
  ) {
    throw new Error('downloaded tarball/member facts drifted from policy');
  }
  const assetId = `${policy.source.package}@${policy.source.version}/${policy.wasm.member}`;
  const payload = {
    schema: 1 as const,
    id: 'rifty.shadow-assets.builtin.v1',
    substitutions: [
      {
        id: 'rifty.shadow-substitution.esbuild-wasi-preview1.v1',
        publicName: 'esbuild',
        builtin: true as const,
        runtimeAdapterId: 'rifty.runtime-adapter.esbuild-vite.v1',
        versions: { [policy.version]: [assetId] },
      },
    ],
    assets: [
      {
        id: assetId,
        source: {
          name: policy.source.package,
          version: policy.source.version,
          integrity: policy.source.integrity,
        },
        member: policy.wasm.member,
        memberSha256: policy.wasm.sha256,
        memberSize: member.byteLength,
        maxTarballBytes: tarball.byteLength,
        maxUnpackedBytes: tar.byteLength,
      },
    ],
  };
  return {
    schema: payload.schema,
    id: payload.id,
    digest: sha256(canonicalJson(payload)),
    substitutions: payload.substitutions,
    assets: payload.assets,
  };
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  if (mode !== '--write' && mode !== '--check') {
    throw new Error('usage: generate-shadow-asset-catalog.ts --write|--check');
  }
  const catalog = await buildCatalog();
  const expected = `${JSON.stringify(catalog, null, 2)}\n`;
  if (mode === '--write') {
    await writeFile(outputUrl, expected);
    console.log('shadow asset catalog: wrote generated/shadow-asset-catalog.json');
    return;
  }
  const actual = JSON.parse(await readFile(outputUrl, 'utf8')) as unknown;
  if (canonicalJson(actual) !== canonicalJson(catalog)) {
    throw new Error('shadow asset catalog drifted; run catalog generator with --write');
  }
  console.log('shadow asset catalog: current');
}

await main();
