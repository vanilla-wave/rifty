/**
 * Playground `npm` shell command over the REAL `@riftydev/npm-client.install`
 * (no `install` stub) against the vendored fixture registry + a REAL eddy
 * server. `npm-shell-command.test.ts` covers the glue's own logic through the
 * documented `install` DI seam; THIS file is the drift tripwire for what a stub
 * cannot vouch for — the real install signature/result shape, the learned-pin
 * write-back carrying the eddy-computed closure hash, the install stamp over a
 * real tree, and the `via eddy (fast)` provenance line.
 */
import type { AddressInfo } from 'node:net';
import { RegistryClient, canonicalEddyRequestKey, unpackEddyBundle } from '@riftydev/npm-client';
import { Shell } from '@riftydev/shell';
import { MemoryVfs } from '@riftydev/vfs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNpmShellCommand } from '../../apps/playground/src/glue/npm-shell-command.ts';
import { type EddyServer, createEddyServer, resolveBundle } from '../../services/eddy/src/index.ts';
import { LOCAL_REGISTRY_BASE_URL, makeLocalFetcher } from './fixtures/local-registry.ts';

const DEPS = { debug: '^4.4.1' };

async function seedProject(vfs: MemoryVfs): Promise<void> {
  await vfs.mkdir('/proj', { recursive: true });
  await vfs.writeFile(
    '/proj/package.json',
    `${JSON.stringify({ name: 'demo', version: '0.0.0', dependencies: DEPS }, null, 2)}\n`,
  );
}

function makeRegistry(): RegistryClient {
  return new RegistryClient({ baseUrl: LOCAL_REGISTRY_BASE_URL, fetch: makeLocalFetcher().fetch });
}

async function runShell(shell: Shell, line: string): Promise<{ exitCode: number; out: string }> {
  const chunks: string[] = [];
  const r = await shell.run(line, {
    onChunk: (chunk, stream) => {
      if (stream === 'stdout') chunks.push(chunk);
    },
  });
  return { exitCode: r.exitCode, out: chunks.join('') };
}

/** The fixture registry is deterministic, so a local resolve computes the same
 * closure hash the eddy server will stamp into its bundle. */
async function expectedClosureHash(): Promise<string> {
  const built = await resolveBundle(
    { dependencies: DEPS },
    { registryBaseUrl: LOCAL_REGISTRY_BASE_URL, fetch: makeLocalFetcher().fetch },
  );
  if (built.kind !== 'bundle') throw new Error('setup: expected a bundle');
  return unpackEddyBundle(built.bytes).manifest.asOf.closureHash;
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

describe('npm shell command → REAL install → real eddy (stub-drift tripwire)', () => {
  it('eddy path: real tree + stamp + learned pin carrying the eddy closure hash + provenance line', async () => {
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    const pins: Array<{ key: string; hash: string }> = [];
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: makeRegistry(),
        resolverUrl: eddyUrl,
        projectSlug: () => 'glue-e2e',
        learnedPins: {
          get: async () => undefined,
          set: async (key, hash) => {
            pins.push({ key, hash });
          },
        },
      }),
    );

    const { exitCode, out } = await runShell(shell, 'npm install');
    await new Promise((r) => setTimeout(r, 0)); // fire-and-forget pin write-back

    expect(exitCode).toBe(0);
    expect(out).toContain('via eddy (fast)');
    // Real tree + lockfile, not a stub's empty result.
    expect(await vfs.exists('/proj/node_modules/debug/package.json')).toBe(true);
    expect(await vfs.exists('/proj/package-lock.json')).toBe(true);
    // Stamp over the REAL package count, keyed on the owner slug.
    const stamp = JSON.parse(
      await vfs.readFileText('/proj/node_modules/.rifty-install-stamp.json'),
    ) as { slug: string; packages: number };
    expect(stamp.slug).toBe('glue-e2e');
    expect(stamp.packages).toBeGreaterThan(0);
    // The learned pin rides the REAL eddy-computed closure hash under the
    // canonical post-merge request key.
    expect(pins).toEqual([
      {
        key: canonicalEddyRequestKey({ dependencies: DEPS, optionalDependencies: {} }),
        hash: await expectedClosureHash(),
      },
    ]);
  });

  it('standard path (no resolverUrl): real install, stamp written, pins never touched', async () => {
    const vfs = new MemoryVfs();
    await seedProject(vfs);
    let pinCalls = 0;
    const shell = new Shell({ cwd: '/proj' });
    shell.registerCommand(
      'npm',
      createNpmShellCommand({
        vfs,
        registry: makeRegistry(),
        learnedPins: {
          get: async () => {
            pinCalls++;
            return undefined;
          },
          set: async () => {
            pinCalls++;
          },
        },
      }),
    );

    const { exitCode, out } = await runShell(shell, 'npm install');
    await new Promise((r) => setTimeout(r, 0));

    expect(exitCode).toBe(0);
    expect(out).not.toContain('via eddy');
    expect(await vfs.exists('/proj/node_modules/debug/package.json')).toBe(true);
    expect(await vfs.exists('/proj/node_modules/.rifty-install-stamp.json')).toBe(true);
    expect(pinCalls).toBe(0); // learned pins are eddy-only (inert without resolverUrl)
  });
});
