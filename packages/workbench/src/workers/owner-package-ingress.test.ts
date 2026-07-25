import {
  type Lockfile,
  type Packument,
  RegistryClient,
  type VersionManifest,
  closureHashOf,
  computeIntegrity,
  install,
  packEddyBundle,
} from '@riftydev/npm-client';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { expect, it, vi } from 'vitest';
import { createInstallStampAuthority } from '../glue/install-stamp-authority.ts';
import { executeNpmInstallOperation, parseNpmInstallRequest } from '../glue/npm-shell-command.ts';
import { createOwnerVfsAuthorityComposition } from './owner-vfs-authority.ts';

const enc = new TextEncoder();
const TAR_TRAILER = new Uint8Array(1024);

function writeTarText(target: Uint8Array, text: string, offset: number, length: number): void {
  const bytes = enc.encode(text);
  target.set(bytes.subarray(0, Math.min(bytes.length, length)), offset);
}

function tarHeader(name: string, size: number): Uint8Array {
  const header = new Uint8Array(512);
  writeTarText(header, name, 0, 100);
  writeTarText(header, '0000644', 100, 7);
  writeTarText(header, '0000000', 108, 7);
  writeTarText(header, '0000000', 116, 7);
  writeTarText(header, size.toString(8).padStart(11, '0'), 124, 11);
  header[135] = 0x20;
  writeTarText(header, '00000000000', 136, 11);
  header[147] = 0x20;
  header.fill(0x20, 148, 156);
  header[156] = '0'.charCodeAt(0);
  writeTarText(header, 'ustar', 257, 6);
  writeTarText(header, '00', 263, 2);
  let checksum = 0;
  for (const byte of header) checksum += byte;
  writeTarText(header, checksum.toString(8).padStart(6, '0'), 148, 6);
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function padded(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.ceil(bytes.byteLength / 512) * 512);
  out.set(bytes);
  return out;
}

async function packageTarball(name: string, files: Readonly<Record<string, string>>) {
  const entries = { 'package.json': JSON.stringify({ name, version: '1.0.0' }), ...files };
  const tarParts: Uint8Array[] = [];
  for (const [path, content] of Object.entries(entries)) {
    const bytes = enc.encode(content);
    tarParts.push(tarHeader(`package/${path}`, bytes.byteLength), padded(bytes));
  }
  const tar = concatBytes([...tarParts, TAR_TRAILER]);
  const compressed = new Blob([tar as unknown as BlobPart])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(compressed).arrayBuffer());
}

interface RegistryEntry {
  readonly manifest: VersionManifest;
  readonly tarball: Uint8Array;
}

class OwnerPolicyRegistry extends RegistryClient {
  readonly calls = { packument: 0, tarball: 0 };

  constructor(private readonly entries: ReadonlyMap<string, RegistryEntry>) {
    super({ baseUrl: '/owner-policy', fetch: async () => new Response('', { status: 599 }) });
  }

  override async getPackument(name: string): Promise<Packument> {
    this.calls.packument += 1;
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`missing fixture package ${name}`);
    return {
      name,
      'dist-tags': { latest: '1.0.0' },
      versions: { '1.0.0': entry.manifest },
    };
  }

  override async getTarball(url: string): Promise<Uint8Array> {
    this.calls.tarball += 1;
    const name = url.slice('fixture:'.length);
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`missing fixture tarball ${url}`);
    return entry.tarball;
  }
}

async function eddyBundleFor(entries: ReadonlyMap<string, RegistryEntry>): Promise<Uint8Array> {
  const dependencies = Object.fromEntries([...entries.keys()].map((name) => [name, '1.0.0']));
  const packages: Lockfile['packages'] = {
    '': { version: '1.0.0', dependencies },
  };
  const tarballs = [];
  for (const [name, entry] of entries) {
    const integrity = await computeIntegrity(entry.tarball);
    const file = `tarballs/${name}-1.0.0.tgz`;
    packages[`node_modules/${name}`] = {
      version: '1.0.0',
      resolved: `fixture:${name}`,
      integrity,
      dependencies: {},
    };
    tarballs.push({
      entry: { file, name, version: '1.0.0', integrity },
      bytes: entry.tarball,
    });
  }
  const lockfile: Lockfile = {
    name: 'root',
    version: '1.0.0',
    lockfileVersion: 3,
    requires: true,
    packages,
  };
  const closureHash = await closureHashOf(lockfile);
  return packEddyBundle({
    manifest: {
      format: 'EddyBundleV1',
      npmClientVersion: '0.1.0',
      asOf: {
        resolvedAt: '2026-07-14T00:00:00.000Z',
        registry: 'https://registry.example.invalid',
        closureHash,
      },
      tarballs: tarballs.map(({ entry }) => entry),
    },
    lockfileText: JSON.stringify(lockfile),
    tarballs,
  });
}

it('rejects a mixed good/forged tar plan through real OwnerVfs before link writes', async () => {
  const { vfs, fsSync } = createMemoryFs();
  fsSync.mkdirSync('/proj', { recursive: true });
  const { authority } = createOwnerVfsAuthorityComposition(fsSync, {
    ownerEpoch: 'package-ingress-owner',
  });
  const entries = new Map<string, RegistryEntry>();
  for (const [name, files] of [
    ['good', { 'ok.js': 'export const ok = true;' }],
    ['evil', { 'node_modules/.rifty-install-stamp.json/payload': '{"forged":true}' }],
  ] as const) {
    entries.set(name, {
      manifest: {
        name,
        version: '1.0.0',
        dist: { tarball: `fixture:${name}` },
      },
      tarball: await packageTarball(name, files),
    });
  }

  const parsed = parseNpmInstallRequest(['good@1.0.0', 'evil@1.0.0']);
  if (parsed.status === 'rejected') throw new Error(parsed.message);
  const sink = { write: (_chunk: string | Uint8Array): void => {} };

  await expect(
    executeNpmInstallOperation(
      parsed.request,
      { cwd: '/proj', env: {}, stdout: sink, stderr: sink },
      {
        vfs,
        registry: new OwnerPolicyRegistry(entries),
        assertPortablePaths: (paths) => authority.assertPortablePaths(paths),
      },
      {
        sessionInstallActivity: false,
        priorTrustedTree: false,
      },
    ),
  ).rejects.toMatchObject({ code: 'EPERM' });

  expect(fsSync.existsSync('/proj/node_modules')).toBe(false);
});

it('rejects an integrity-valid Eddy bundle through Owner policy before the first link', async () => {
  const { vfs, fsSync } = createMemoryFs();
  fsSync.mkdirSync('/proj', { recursive: true });
  const { authority, installStampClaims } = createOwnerVfsAuthorityComposition(fsSync, {
    ownerEpoch: 'eddy-package-ingress-owner',
  });
  const entries = new Map<string, RegistryEntry>();
  for (const [name, files] of [
    ['good', { 'ok.js': 'export const ok = true;' }],
    ['evil', { 'node_modules/.rifty-install-stamp.json/payload': '{"forged":true}' }],
  ] as const) {
    const tarball = await packageTarball(name, files);
    entries.set(name, {
      manifest: {
        name,
        version: '1.0.0',
        dist: { tarball: `fixture:${name}`, integrity: await computeIntegrity(tarball) },
      },
      tarball,
    });
  }
  const bundle = await eddyBundleFor(entries);
  const registry = new OwnerPolicyRegistry(entries);
  const resolverCalls: Array<{ readonly method: string }> = [];
  const warnings: string[] = [];
  const progress: Array<{ readonly name: string; readonly cacheHit: boolean }> = [];
  const preflights: string[][] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      resolverCalls.push({ method: init?.method ?? 'GET' });
      return new Response(new Blob([bundle as unknown as BlobPart]), {
        status: 200,
        headers: { 'content-type': 'application/x-tar' },
      });
    }),
  );
  const warn = vi.spyOn(console, 'warn').mockImplementation((message) => {
    warnings.push(String(message));
  });

  try {
    await expect(
      install(
        'root',
        '1.0.0',
        { good: '1.0.0', evil: '1.0.0' },
        {
          vfs,
          cwd: '/proj',
          registry,
          resolverUrl: 'https://eddy.example.invalid/resolve',
          onPackage: ({ name, cacheHit }) => progress.push({ name, cacheHit }),
          assertPortablePaths: (paths) => {
            preflights.push([...paths]);
            authority.assertPortablePaths(paths);
          },
        },
      ),
    ).rejects.toMatchObject({ code: 'EPERM' });

    expect(resolverCalls).toEqual([{ method: 'POST' }]);
    expect(registry.calls).toEqual({ packument: 0, tarball: 0 });
    expect(progress).toEqual(
      expect.arrayContaining([
        { name: 'good', cacheHit: true },
        { name: 'evil', cacheHit: true },
      ]),
    );
    expect(preflights).toHaveLength(1);
    expect(preflights[0]).toContain(
      '/proj/node_modules/evil/node_modules/.rifty-install-stamp.json/payload',
    );
    expect(warnings.some((message) => message.includes('using standard install'))).toBe(false);
    expect(fsSync.existsSync('/proj/node_modules')).toBe(false);
    expect(fsSync.existsSync('/proj/package-lock.json')).toBe(false);
    expect(installStampClaims.read('/proj')).toBeNull();
    const stampAuthority = createInstallStampAuthority({
      vfs,
      fsSync: authority,
      claimIo: installStampClaims,
    });
    await expect(stampAuthority.check({ root: '/proj', slug: 'root' })).resolves.toEqual({
      status: 'absent',
    });
  } finally {
    warn.mockRestore();
    vi.unstubAllGlobals();
  }
});
