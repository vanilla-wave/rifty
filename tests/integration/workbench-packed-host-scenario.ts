import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { RegistryClient } from '@riftydev/npm-client';
import { MemoryFsSync, resetSyncMirror } from '@riftydev/vfs/internal';
import { createPlaygroundProjectCatalog } from '../../packages/workbench/src/workbench/internal/playground-project-catalog.ts';
import { definePlaygroundProject } from '../../packages/workbench/src/workbench/internal/playground-project-definition.ts';
import type {
  PlaygroundProjectCatalog,
  VitePlaygroundPlan,
} from '../../packages/workbench/src/workbench/playground.ts';
import type { ProjectDefinition } from '../../packages/workbench/src/workbench/public.ts';
import { createOwnerVfsAuthorityComposition } from '../../packages/workbench/src/workers/owner-vfs-authority.ts';
import { createPlaygroundProjectAuthority } from '../../packages/workbench/src/workers/playground-project-authority.ts';
import { PACKED_HOST_COMPOSITION } from './fixtures/workbench-vite-consumer/src/packed-host-composition.ts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const workbenchDepSnapshot = resolve(repoRoot, 'packages/workbench/src/dep-snapshot.ts');
const encoder = new TextEncoder();
const SCRATCH_TREE = '/.rifty/workbench/v1/projects/scratch/tree';
const ORPHAN_BYTES = encoder.encode('orphan bytes');
const CAPTURED_URL_CONTEXT = Object.freeze({
  apiBaseUrl: 'https://playground.invalid/app/',
  clientUrl: 'https://playground.invalid/app/index.html',
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
      rejectRun(new Error(`${command} ${args.join(' ')} failed (${String(code)}): ${stderr}`));
    });
  });
}

export async function produceFromInstalledWorkbenchTarball(): Promise<ProducedSnapshot> {
  const temp = await mkdtemp(join(tmpdir(), 'rifty-packed-produce-'));
  try {
    const stage = join(temp, 'stage');
    const tarballRoot = join(temp, 'tarballs');
    const extracted = join(temp, 'extracted');
    await mkdir(stage);
    await mkdir(tarballRoot);
    await mkdir(extracted);
    await writeFile(
      join(stage, 'package.json'),
      JSON.stringify({
        name: '@riftydev/workbench',
        version: '0.1.0',
        type: 'module',
        exports: { './dep-snapshot': './dep-snapshot.mjs' },
      }),
    );
    await writeFile(
      join(stage, 'dep-snapshot.mjs'),
      `export { produceDepSnapshot } from ${JSON.stringify(pathToFileURL(workbenchDepSnapshot).href)};\n`,
    );
    const packed = await run(
      'npm',
      ['pack', '--ignore-scripts', '--pack-destination', tarballRoot],
      stage,
    );
    const tarballName = packed.trim().split('\n').at(-1);
    if (tarballName === undefined || tarballName.length === 0) {
      throw new Error('npm pack did not emit a workbench tarball');
    }
    await run('tar', ['-xzf', join(tarballRoot, tarballName), '-C', extracted], temp);
    const api = (await import(pathToFileURL(join(extracted, 'package/dep-snapshot.mjs')).href)) as {
      produceDepSnapshot(input: {
        readonly templateId: string;
        readonly packageJsonText: string;
        readonly packageLockText: string;
        readonly registry: RegistryClient;
      }): Promise<{ readonly snapshotId: string; readonly tarBytes: Uint8Array }>;
    };
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
    return {
      downloaded,
      host: {
        scope: PACKED_HOST_COMPOSITION.scope,
        previewPrefix: PACKED_HOST_COMPOSITION.previewPrefix,
        snapshotOnly: PACKED_HOST_COMPOSITION.snapshotOnly,
      },
    };
  } finally {
    await owner.close();
    resetSyncMirror();
  }
}
