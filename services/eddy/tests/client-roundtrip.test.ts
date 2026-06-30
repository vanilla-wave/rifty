/**
 * Full eddy round-trip + auto-fallback matrix (ADR-0182 §5,
 * `npm-client/eddy-client-opt-in`). A REAL eddy server over the vendored
 * fixture registry drives the client's `install({ resolverUrl })`; the failure
 * cases use real raw HTTP servers (closed port, 5xx, tampered bytes, coverage
 * gap) — nothing about the unit under test is mocked.
 */
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { RegistryClient, install, packEddyBundle, unpackEddyBundle } from '@riftydev/npm-client';
import { MemoryVfs } from '@riftydev/vfs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  LOCAL_REGISTRY_BASE_URL,
  makeLocalFetcher,
} from '../../../tests/integration/fixtures/local-registry.ts';
import { resolveBundle } from '../src/index.ts';
import { type EddyServer, createEddyServer } from '../src/server.ts';

function makeRegistry() {
  const { fetch, calls } = makeLocalFetcher();
  return { registry: new RegistryClient({ baseUrl: LOCAL_REGISTRY_BASE_URL, fetch }), calls };
}

async function writePackageJson(vfs: MemoryVfs, deps: Record<string, string>): Promise<void> {
  await vfs.mkdir('/app', { recursive: true });
  await vfs.writeFile(
    '/app/package.json',
    JSON.stringify({ name: 'app', version: '1.0.0', dependencies: deps }),
  );
}

function startRaw(
  handler: Parameters<typeof createServer>[1],
): Promise<{ url: string; server: Server }> {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ url: `http://127.0.0.1:${port}`, server });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}

let eddy: EddyServer;
let eddyUrl: string;

beforeEach(async () => {
  eddy = createEddyServer({
    registryBaseUrl: LOCAL_REGISTRY_BASE_URL,
    fetch: makeLocalFetcher().fetch,
  });
  await eddy.listen(0);
  eddyUrl = `http://127.0.0.1:${(eddy.address() as AddressInfo).port}`;
});
afterEach(async () => {
  await eddy.close();
});

const DEPS = { debug: '^4.4.1', 'diamond-conflict-parent': '1.0.0' };

describe('eddy client opt-in — fast path + auto-fallback', () => {
  it('fast path produces a tree+lockfile identical to a standard install, with zero own-registry traffic', async () => {
    // Standard reference.
    const stdVfs = new MemoryVfs();
    await writePackageJson(stdVfs, DEPS);
    const std = makeRegistry();
    const standard = await install({ vfs: stdVfs, cwd: '/app', registry: std.registry });
    expect(standard.source ?? 'standard').toBe('standard');

    // Eddy fast path.
    const fastVfs = new MemoryVfs();
    await writePackageJson(fastVfs, DEPS);
    const fast = makeRegistry();
    const result = await install({
      vfs: fastVfs,
      cwd: '/app',
      registry: fast.registry,
      resolverUrl: eddyUrl,
    });

    expect(result.source).toBe('eddy');
    // Zero packument/tarball traffic to the CLIENT's own registry (all from the bundle).
    expect(fast.calls.packument).toBe(0);
    expect(fast.calls.tarball).toBe(0);
    // Byte-identical lockfile (same root name → identical, including the diamond layout).
    expect(result.lockfile).toEqual(standard.lockfile);
    // node_modules materialized.
    expect(await fastVfs.exists('/app/node_modules/debug/package.json')).toBe(true);
    expect(
      await fastVfs.exists(
        '/app/node_modules/diamond-conflict-parent/node_modules/ms/package.json',
      ),
    ).toBe(true);
  });

  it('falls back to standard install when the resolver is unreachable (warns, never throws)', async () => {
    const vfs = new MemoryVfs();
    await writePackageJson(vfs, DEPS);
    const { registry } = makeRegistry();
    const result = await install({ vfs, cwd: '/app', registry, resolverUrl: 'http://127.0.0.1:1' });
    expect(result.source).toBe('standard');
    expect(await vfs.exists('/app/node_modules/debug/package.json')).toBe(true);
  });

  it('falls back when the resolver returns 5xx', async () => {
    const raw = await startRaw((_req, res) => {
      res.writeHead(503);
      res.end('upstream down');
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, DEPS);
      const { registry } = makeRegistry();
      const result = await install({ vfs, cwd: '/app', registry, resolverUrl: raw.url });
      expect(result.source).toBe('standard');
      expect(await vfs.exists('/app/node_modules/debug/package.json')).toBe(true);
    } finally {
      await closeServer(raw.server);
    }
  });

  it('falls back (NOT a silent wrong install) when a bundle tarball fails integrity', async () => {
    // Build a real bundle, then tamper one tarball's bytes while leaving the
    // manifest integrity intact → the client's non-disableable byte check trips.
    const built = await resolveBundle(
      { dependencies: DEPS },
      { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch: makeLocalFetcher().fetch },
    );
    expect(built.kind).toBe('bundle');
    if (built.kind !== 'bundle') return;
    const contents = unpackEddyBundle(built.bytes);
    const victim = contents.tarballs[0];
    expect(victim).toBeDefined();
    if (!victim) return;
    const tampered = new Uint8Array(victim.bytes);
    const idx = Math.min(10, tampered.length - 1);
    tampered[idx] = (tampered[idx] ?? 0) ^ 0xff;
    victim.bytes = tampered; // manifest integrity unchanged → mismatch on the client
    const tamperedBytes = packEddyBundle(contents);

    const raw = await startRaw((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-tar' });
      res.end(Buffer.from(tamperedBytes));
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, DEPS);
      const { registry } = makeRegistry();
      const result = await install({ vfs, cwd: '/app', registry, resolverUrl: raw.url });
      expect(result.source).toBe('standard');
      // Standard install produced the correct tree (debug present, real bytes).
      expect(await vfs.exists('/app/node_modules/debug/package.json')).toBe(true);
    } finally {
      await closeServer(raw.server);
    }
  });

  it('falls back when the bundle lockfile does not cover the requested deps', async () => {
    // Server always returns a bundle for {debug} only; client requests debug + kleur.
    const built = await resolveBundle(
      { dependencies: { debug: '^4.4.1' } },
      { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch: makeLocalFetcher().fetch },
    );
    if (built.kind !== 'bundle') throw new Error('setup');
    const raw = await startRaw((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/x-tar' });
      res.end(Buffer.from(built.bytes));
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, { debug: '^4.4.1', kleur: '4.1.5' });
      const { registry } = makeRegistry();
      const result = await install({ vfs, cwd: '/app', registry, resolverUrl: raw.url });
      expect(result.source).toBe('standard');
      expect(await vfs.exists('/app/node_modules/kleur/package.json')).toBe(true);
    } finally {
      await closeServer(raw.server);
    }
  });

  it('falls back on a typed "unsupported" decline', async () => {
    const raw = await startRaw((_req, res) => {
      res.writeHead(422, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ kind: 'unsupported', feature: 'file', message: 'use standard' }));
    });
    try {
      const vfs = new MemoryVfs();
      await writePackageJson(vfs, DEPS);
      const { registry } = makeRegistry();
      const result = await install({ vfs, cwd: '/app', registry, resolverUrl: raw.url });
      expect(result.source).toBe('standard');
      expect(await vfs.exists('/app/node_modules/debug/package.json')).toBe(true);
    } finally {
      await closeServer(raw.server);
    }
  });

  it('is inert when resolverUrl is unset (source standard, identical to today)', async () => {
    const vfs = new MemoryVfs();
    await writePackageJson(vfs, DEPS);
    const { registry, calls } = makeRegistry();
    const result = await install({ vfs, cwd: '/app', registry });
    expect(result.source ?? 'standard').toBe('standard');
    expect(calls.packument).toBeGreaterThan(0); // it really did resolve via the registry
  });
});
