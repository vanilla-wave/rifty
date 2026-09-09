import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RegistryClient } from '@riftydev/npm-client';
import { MemoryFsSync, resetSyncMirror } from '@riftydev/vfs/internal';
import { createPlaygroundProjectCatalog } from '../../packages/workbench/src/workbench/internal/playground-project-catalog.ts';
import { definePlaygroundProject } from '../../packages/workbench/src/workbench/internal/playground-project-definition.ts';
import { validateWorkbenchOptions } from '../../packages/workbench/src/workbench/internal/workbench-options.ts';
import type {
  PlaygroundProjectCatalog,
  VitePlaygroundPlan,
} from '../../packages/workbench/src/workbench/playground.ts';
import type { ProjectDefinition } from '../../packages/workbench/src/workbench/public.ts';
import { createOwnerVfsAuthorityComposition } from '../../packages/workbench/src/workers/owner-vfs-authority.ts';
import { createPlaygroundProjectAuthority } from '../../packages/workbench/src/workers/playground-project-authority.ts';
import { PACKED_HOST_COMPOSITION } from './fixtures/workbench-vite-consumer/src/packed-host-composition.ts';
import { importProduceDepSnapshot } from './workbench-packed-host-produce.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workbenchRoot = resolve(repoRoot, 'packages/workbench');
const encoder = new TextEncoder();
const SCRATCH_TREE = '/.rifty/workbench/v1/projects/scratch/tree';
const ORPHAN_BYTES = encoder.encode('orphan bytes');
const CAPTURED_URL_CONTEXT = Object.freeze({
  apiBaseUrl: 'https://playground.invalid/sandbox/',
  clientUrl: 'https://playground.invalid/sandbox/',
});
const PACKED_HOST_URL_CONTEXT = Object.freeze({
  apiBaseUrl: new URL('https://playground.invalid/sandbox/'),
  clientUrl: new URL('https://playground.invalid/sandbox/'),
});

interface ProducedSnapshot {
  readonly snapshotId: string;
  readonly tarBytes: Uint8Array;
  readonly entry: '@riftydev/workbench/dep-snapshot';
}

interface PackedHostOrphanProof {
  readonly downloaded: string;
  readonly host: {
    readonly scope: '/sandbox/';
    readonly previewPrefix: '/sandbox/preview';
    readonly snapshotOnly: true;
  };
}

type RetainedOrphanCatalog = PlaygroundProjectCatalog & {
  listRetainedOrphans(): Promise<readonly { readonly id: string }[]>;
  readRetainedOrphanFile(id: string, path: string): Promise<Uint8Array>;
};

function run(command: string, args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', rejectRun);
    child.on('close', (code) => {
      if (code === 0) {
        resolveRun(stdout);
        return;
      }
      rejectRun(
        new Error(
          `${command} ${args.join(' ')} failed (${String(code)}): ${stderr || stdout}`.trim(),
        ),
      );
    });
  });
}

function excludeWorkbenchPackExtras(source: string): boolean {
  const rel = relative(workbenchRoot, source);
  if (rel === '') return true;
  const top = rel.split(sep)[0];
  return top !== 'node_modules' && top !== 'dist';
}

function admittedPackedHost(): PackedHostOrphanProof['host'] {
  const admitted = validateWorkbenchOptions(
    {
      deployment: {
        workers: {
          owner: '/sandbox/runtime/owner-worker.js',
          kernel: '/sandbox/runtime/kernel-worker.js',
          node: '/sandbox/runtime/node-worker.js',
          devServer: '/sandbox/runtime/dev-server-worker.js',
        },
        serviceWorker: {
          url: '/sandbox/runtime/sw.js',
          scope: PACKED_HOST_COMPOSITION.scope,
        },
        wasm: { sqlite: '/sandbox/runtime/sqlite.wasm' },
        previewPrefix: PACKED_HOST_COMPOSITION.previewPrefix,
        ownerStartupTimeoutMs: PACKED_HOST_COMPOSITION.ownerStartupTimeoutMs,
        projectFileTimeoutMs: PACKED_HOST_COMPOSITION.projectFileTimeoutMs,
        sessionToolsTimeoutMs: PACKED_HOST_COMPOSITION.sessionToolsTimeoutMs,
      },
      packageAcquisition: {},
      storage: {
        persistence: 'required',
        namespace: PACKED_HOST_COMPOSITION.namespace,
      },
    },
    PACKED_HOST_URL_CONTEXT,
  );
  const scopePath = new URL(admitted.serviceWorker.scope).pathname;
  const previewPrefix = admitted.owner.deployment.previewPrefix;
  if (scopePath !== '/sandbox/' || previewPrefix !== '/sandbox/preview') {
    throw new Error(
      `admitted packed-host composition drifted: ${JSON.stringify({ scopePath, previewPrefix })}`,
    );
  }
  if (Object.hasOwn(admitted.owner.packageAcquisition, 'registryUrl')) {
    throw new Error('admitted packed-host composition is not snapshot-only');
  }
  return Object.freeze({
    scope: '/sandbox/',
    previewPrefix: '/sandbox/preview',
    snapshotOnly: true,
  });
}

export async function produceFromInstalledWorkbenchTarball(): Promise<ProducedSnapshot> {
  const temp = await mkdtemp(join(repoRoot, 'tests/integration/.tmp-packed-produce-'));
  try {
    const stage = join(temp, 'stage');
    const tarballRoot = join(temp, 'tarballs');
    const extracted = join(temp, 'extracted');
    await mkdir(tarballRoot);
    await mkdir(extracted);
    await cp(workbenchRoot, stage, { recursive: true, filter: excludeWorkbenchPackExtras });
    const manifest = JSON.parse(await readFile(join(stage, 'package.json'), 'utf8')) as {
      files?: readonly string[];
      publishConfig?: unknown;
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    };
    const { publishConfig: _publishConfig, ...packable } = manifest;
    const stagedManifest = {
      ...packable,
      files: ['src', 'CHANGELOG.md'],
    };
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies'] as const) {
      const deps = stagedManifest[field];
      if (deps === undefined) continue;
      for (const [name, specifier] of Object.entries(deps)) {
        if (specifier.startsWith('workspace:')) deps[name] = '0.1.0';
      }
    }
    await writeFile(join(stage, 'package.json'), `${JSON.stringify(stagedManifest, null, 2)}\n`);
    const before = new Set(await readdir(tarballRoot));
    await run('npm', ['pack', '--ignore-scripts', '--pack-destination', tarballRoot], stage);
    const created = (await readdir(tarballRoot)).filter(
      (entry) => entry.endsWith('.tgz') && !before.has(entry),
    );
    const tarballName = created[0];
    if (created.length !== 1 || tarballName === undefined) {
      throw new Error(`packing workbench created ${String(created.length)} tarballs`);
    }
    await run('tar', ['-xzf', join(tarballRoot, tarballName), '-C', extracted], temp);
    const api = await importProduceDepSnapshot(join(extracted, 'package'));
    const packageJsonText = JSON.stringify({ name: 'packed-host-caller', version: '1.0.0' });
    const baked = await api.produceDepSnapshot({
      templateId: 'packed-host',
      packageJsonText,
      packageLockText: JSON.stringify({
        name: 'packed-host-caller',
        lockfileVersion: 3,
        requires: true,
        packages: { '': { name: 'packed-host-caller', version: '1.0.0' } },
      }),
      registry: new RegistryClient({
        baseUrl: '/packed-host-registry',
        fetch: async () => new Response('', { status: 599 }),
      }),
    });
    return {
      snapshotId: baked.snapshotId,
      tarBytes: baked.tarBytes,
      entry: '@riftydev/workbench/dep-snapshot',
    };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

function plan(): VitePlaygroundPlan {
  return {
    kind: 'vite',
    id: 'scratch',
    starterId: 'starter-a',
    templateId: 'vite-template-v1',
    files: {
      '/index.html': '<main>packed host orphan</main>\n',
      '/package.json': '{"scripts":{"dev":"vite"},"devDependencies":{"vite":"8.0.0"}}\n',
      '/src/main.ts': 'document.body.dataset.ready = "yes";\n',
    },
    devDependencies: { vite: '8.0.0' },
    port: 5173,
    firstMaterialization: { kind: 'install' },
  };
}

function definition(): ProjectDefinition<unknown> {
  return definePlaygroundProject(plan(), CAPTURED_URL_CONTEXT);
}

export async function provePackedHostOrphanRetain(): Promise<PackedHostOrphanProof> {
  const host = admittedPackedHost();
  const fs = new MemoryFsSync();
  fs.mkdirSync(`${SCRATCH_TREE}/src`, { recursive: true });
  fs.writeFileSync(`${SCRATCH_TREE}/user.txt`, ORPHAN_BYTES);
  const composition = createOwnerVfsAuthorityComposition(fs, {
    ownerEpoch: 'packed-host-orphan-owner',
    initialRoots: ['/', '/.rifty'],
  });
  let stageSequence = 0;
  const owner = await createPlaygroundProjectAuthority({
    ...composition,
    persistence: 'required',
    now: () => '2026-09-09T12:00:00.000Z',
    createStageId: () => `packed-host-stage-${String(++stageSequence)}`,
    acquisition: Object.freeze({
      ensure: async () => Object.freeze({ kind: 'install' as const, snapshotFailures: [] }),
    }),
    projectSave: {
      projectSave: async (_input, run) => run(async () => ({ status: 'untrusted' })),
    },
  });
  try {
    const catalog = createPlaygroundProjectCatalog(owner) as RetainedOrphanCatalog;
    await catalog.createScratch({ definition: definition() });
    const orphans = await catalog.listRetainedOrphans();
    const id = orphans[0]?.id;
    if (id === undefined) throw new Error('packed-host orphan retain published no row');
    const downloaded = new TextDecoder('utf-8', { fatal: true }).decode(
      await catalog.readRetainedOrphanFile(id, 'user.txt'),
    );
    return { downloaded, host };
  } finally {
    await owner.close();
    resetSyncMirror();
  }
}
