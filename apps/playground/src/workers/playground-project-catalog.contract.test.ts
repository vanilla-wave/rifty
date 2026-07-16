import type { FsSync } from '@riftydev/vfs';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { ProjectBusyError, ProjectDefinitionMismatchError } from '../workbench/errors.ts';
import { createPlaygroundProjectCatalog } from '../workbench/internal/playground-project-catalog.ts';
import { definePlaygroundProject } from '../workbench/internal/playground-project-definition.ts';
import type {
  NodeCliPlaygroundPlan,
  NodeServerPlaygroundPlan,
  PlaygroundCatalogSnapshot,
  PlaygroundProjectCatalog,
  PlaygroundProjectPlan,
  VitePlaygroundPlan,
} from '../workbench/playground.ts';
import type { ProjectDefinition } from '../workbench/public.ts';
import {
  type OwnerVfsAuthority,
  type OwnerVfsAuthorityComposition,
  createOwnerVfsAuthorityComposition,
} from './owner-vfs-authority.ts';
import {
  type PlaygroundProjectAuthority,
  createPlaygroundProjectAuthority,
} from './playground-project-authority.ts';
import {
  type DurableOwnerFault,
  DurableOwnerFs,
  type ExactFsTree,
  createDurableOwnerFsFromTree,
} from './test-fixtures/durable-owner-fs.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const CAPTURED_URL_CONTEXT = Object.freeze({
  apiBaseUrl: 'https://playground.invalid/app/',
  clientUrl: 'https://playground.invalid/app/index.html',
});
const EDITED_AT = '2026-07-16T12:00:00.000Z';

type OpenedProject = Awaited<ReturnType<PlaygroundProjectAuthority['openProject']>>;

function plan(
  id: string,
  starterId = 'starter-a',
  overrides: Partial<VitePlaygroundPlan> = {},
): VitePlaygroundPlan {
  return {
    kind: 'vite',
    id,
    starterId,
    templateId: 'vite-template-v1',
    files: {
      '/index.html': '<main>catalog contract</main>\n',
      '/package.json': '{"scripts":{"dev":"vite"},"devDependencies":{"vite":"8.0.0"}}\n',
      '/src/main.ts': 'document.body.dataset.ready = "yes";\n',
    },
    devDependencies: { vite: '8.0.0' },
    port: 5173,
    firstMaterialization: { kind: 'install' },
    ...overrides,
  };
}

function definition(
  id: string,
  starterId = 'starter-a',
  overrides: Partial<VitePlaygroundPlan> = {},
): ProjectDefinition<unknown> {
  return projectDefinition(plan(id, starterId, overrides));
}

function projectDefinition(plan: PlaygroundProjectPlan): ProjectDefinition<unknown> {
  return definePlaygroundProject(plan, CAPTURED_URL_CONTEXT);
}

function freezeExpected<T>(value: T): T {
  if (value === null || typeof value !== 'object' || value instanceof Uint8Array) return value;
  for (const nested of Object.values(value)) freezeExpected(nested);
  return Object.freeze(value);
}

const EMPTY = freezeExpected<PlaygroundCatalogSnapshot>({
  active: null,
  scratch: null,
  projects: [],
});

interface CatalogHarness {
  readonly fs: MemoryFsSync;
  readonly authority: OwnerVfsAuthority;
  readonly installStampClaims: OwnerVfsAuthorityComposition['installStampClaims'];
  readonly owner: PlaygroundProjectAuthority;
  readonly catalog: PlaygroundProjectCatalog;
}

async function harness(
  fs = new MemoryFsSync(),
  now: () => string = () => EDITED_AT,
): Promise<CatalogHarness> {
  const composition = createOwnerVfsAuthorityComposition(fs, {
    ownerEpoch: 'playground-catalog-contract-owner',
    initialRoots: ['/', '/.rifty'],
  });
  let stageSequence = 0;
  const owner = await createPlaygroundProjectAuthority({
    ...composition,
    persistence: 'required',
    now,
    createStageId: () => `catalog-stage-${String(++stageSequence)}`,
    acquisition: Object.freeze({
      ensure: async () => Object.freeze({ kind: 'install' as const, snapshotFailures: [] }),
    }),
  });
  return {
    fs,
    authority: composition.authority,
    installStampClaims: composition.installStampClaims,
    owner,
    catalog: createPlaygroundProjectCatalog(owner),
  };
}

function treeFiles(fs: FsSync, root: string): Readonly<Record<string, readonly number[]>> {
  const files: Record<string, readonly number[]> = {};
  const walk = (directory: string): void => {
    for (const entry of fs.readdirSync(directory)) {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory) walk(path);
      else files[path.slice(root.length)] = [...fs.readFileBytesSync(path)];
    }
  };
  walk(root);
  return Object.fromEntries(
    Object.entries(files).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function expectFrozenSnapshot(snapshot: PlaygroundCatalogSnapshot): void {
  expect(Object.isFrozen(snapshot)).toBe(true);
  expect(Object.isFrozen(snapshot.projects)).toBe(true);
  if (snapshot.active !== null) expect(Object.isFrozen(snapshot.active)).toBe(true);
  if (snapshot.scratch !== null) expect(Object.isFrozen(snapshot.scratch)).toBe(true);
  for (const project of snapshot.projects) expect(Object.isFrozen(project)).toBe(true);
}

async function close(opened: OpenedProject): Promise<void> {
  await opened.close();
}

describe('PlaygroundProjectCatalog public contract', () => {
  it('derives Starter provenance only from a companion definition and exposes no owner plumbing', async () => {
    expectTypeOf<Parameters<PlaygroundProjectCatalog['createScratch']>[0]>().toEqualTypeOf<{
      readonly definition: ProjectDefinition<unknown>;
      readonly preserveDirtySameStarter?: boolean;
    }>();

    const h = await harness();
    expect(Object.keys(h.catalog).sort()).toEqual([
      'activate',
      'createScratch',
      'delete',
      'rename',
      'reset',
      'saveScratch',
      'snapshot',
      'subscribe',
    ]);
    expect(h.catalog).not.toHaveProperty('recordMutation');
    expect(h.catalog).not.toHaveProperty('openProject');
    expect(h.catalog).not.toHaveProperty('projectRoot');

    const snapshot = await h.catalog.createScratch({ definition: definition('scratch') });

    expect(snapshot).toEqual({
      active: { kind: 'scratch' },
      scratch: { starterId: 'starter-a', dirty: false, editedAt: EDITED_AT },
      projects: [],
    });
    expectFrozenSnapshot(snapshot);
    await h.owner.close();
  });

  it('starts exact-empty, synchronously replays, publishes frozen snapshots in operation order, and settles after reflection', async () => {
    const h = await harness();
    const observed: PlaygroundCatalogSnapshot[] = [];
    const events: string[] = [];

    expect(h.catalog.snapshot()).toEqual(EMPTY);
    expectFrozenSnapshot(h.catalog.snapshot());
    const unsubscribe = h.catalog.subscribe((snapshot) => {
      observed.push(snapshot);
      events.push(`publish:${snapshot.active?.kind ?? 'empty'}`);
    });
    expect(observed).toEqual([EMPTY]);

    const creating = h.catalog.createScratch({ definition: definition('scratch') });
    void creating.then(() => events.push('resolved:create'));
    await creating;
    expect(events.slice(-2)).toEqual(['publish:scratch', 'resolved:create']);

    const saving = h.catalog.saveScratch({
      id: 'project-a',
      name: 'Project A',
      definition: definition('project-a'),
    });
    void saving.then(() => events.push('resolved:save'));
    const saved = await saving;
    expect(events.slice(-2)).toEqual(['publish:project', 'resolved:save']);
    expect(saved).toEqual({
      active: { kind: 'project', id: 'project-a' },
      scratch: null,
      projects: [
        {
          id: 'project-a',
          name: 'Project A',
          starterId: 'starter-a',
          editedAt: EDITED_AT,
        },
      ],
    });
    expectFrozenSnapshot(saved);
    expect(h.catalog.snapshot()).toBe(observed.at(-1));

    unsubscribe();
    await h.catalog.rename('project-a', 'Renamed');
    expect(observed.at(-1)).toBe(saved);
    await h.owner.close();
  });

  it('uses one stored creation order and exact active-selection rules across Scratch and projects', async () => {
    const h = await harness();
    await h.catalog.createScratch({ definition: definition('scratch') });
    await h.catalog.saveScratch({
      id: 'project-a',
      name: 'Project A',
      definition: definition('project-a'),
    });
    await h.catalog.createScratch({
      definition: definition('scratch', 'starter-b', {
        files: { '/index.html': '<main>starter b</main>\n' },
      }),
    });
    await h.catalog.saveScratch({
      id: 'project-b',
      name: 'Project B',
      definition: definition('project-b', 'starter-b', {
        files: { '/index.html': '<main>starter b</main>\n' },
      }),
    });
    await h.catalog.createScratch({
      definition: definition('scratch', 'starter-c', {
        files: { '/index.html': '<main>starter c</main>\n' },
      }),
    });

    expect(h.catalog.snapshot()).toEqual({
      active: { kind: 'scratch' },
      scratch: { starterId: 'starter-c', dirty: false, editedAt: EDITED_AT },
      projects: [
        {
          id: 'project-a',
          name: 'Project A',
          starterId: 'starter-a',
          editedAt: EDITED_AT,
        },
        {
          id: 'project-b',
          name: 'Project B',
          starterId: 'starter-b',
          editedAt: EDITED_AT,
        },
      ],
    });

    await h.catalog.activate({ kind: 'project', id: 'project-b' });
    await h.catalog.delete('project-b');
    expect(h.catalog.snapshot().active).toEqual({ kind: 'scratch' });
    await h.catalog.activate({ kind: 'project', id: 'project-a' });
    await h.catalog.delete('project-a');
    expect(h.catalog.snapshot().active).toEqual({ kind: 'scratch' });
    await h.catalog.activate({ kind: 'scratch' });
    expect(h.catalog.snapshot().active).toEqual({ kind: 'scratch' });
    await expect(h.catalog.activate({ kind: 'project', id: 'missing' })).rejects.toThrow();
    expect(h.catalog.snapshot().projects).toEqual([]);
    await h.owner.close();

    const withoutScratch = await harness();
    await withoutScratch.catalog.createScratch({ definition: definition('scratch') });
    await withoutScratch.catalog.saveScratch({
      id: 'first',
      name: 'First',
      definition: definition('first'),
    });
    await withoutScratch.catalog.createScratch({ definition: definition('scratch') });
    await withoutScratch.catalog.saveScratch({
      id: 'second',
      name: 'Second',
      definition: definition('second'),
    });
    await withoutScratch.catalog.activate({ kind: 'project', id: 'first' });
    await withoutScratch.catalog.delete('first');
    expect(withoutScratch.catalog.snapshot().active).toEqual({ kind: 'project', id: 'second' });
    await withoutScratch.catalog.delete('second');
    expect(withoutScratch.catalog.snapshot()).toEqual(EMPTY);
    await withoutScratch.owner.close();
  });

  it('rejects absent refs, the reserved named id, and every definition/target-id mismatch before effects', async () => {
    const h = await harness();
    const before = h.catalog.snapshot();

    await expect(h.catalog.activate({ kind: 'scratch' })).rejects.toThrow();
    await expect(
      h.catalog.createScratch({ definition: definition('not-scratch') }),
    ).rejects.toBeInstanceOf(ProjectDefinitionMismatchError);
    expect(h.catalog.snapshot()).toBe(before);

    await h.catalog.createScratch({ definition: definition('scratch') });
    const scratch = h.catalog.snapshot();
    await expect(
      h.catalog.saveScratch({
        id: 'scratch',
        name: 'Reserved',
        definition: definition('scratch'),
      }),
    ).rejects.toThrow();
    await expect(
      h.catalog.saveScratch({
        id: 'project-a',
        name: 'Project A',
        definition: definition('project-b'),
      }),
    ).rejects.toBeInstanceOf(ProjectDefinitionMismatchError);
    await expect(
      h.catalog.reset({
        target: { kind: 'scratch' },
        definition: definition('project-a'),
      }),
    ).rejects.toBeInstanceOf(ProjectDefinitionMismatchError);
    expect(h.catalog.snapshot()).toBe(scratch);

    await h.catalog.saveScratch({
      id: 'project-a',
      name: 'Project A',
      definition: definition('project-a'),
    });
    const project = h.catalog.snapshot();
    await expect(
      h.catalog.reset({
        target: { kind: 'project', id: 'project-a' },
        definition: definition('project-b'),
      }),
    ).rejects.toBeInstanceOf(ProjectDefinitionMismatchError);
    expect(h.catalog.snapshot()).toBe(project);
    await h.owner.close();
  });

  it('preserves the active ref when deleting a non-active project', async () => {
    const h = await harness();
    await h.catalog.createScratch({ definition: definition('scratch') });
    await h.catalog.saveScratch({
      id: 'project-a',
      name: 'Project A',
      definition: definition('project-a'),
    });
    await h.catalog.createScratch({ definition: definition('scratch', 'starter-b') });
    await h.catalog.saveScratch({
      id: 'project-b',
      name: 'Project B',
      definition: definition('project-b', 'starter-b'),
    });
    await h.catalog.activate({ kind: 'project', id: 'project-a' });

    await h.catalog.delete('project-b');

    expect(h.catalog.snapshot().active).toEqual({ kind: 'project', id: 'project-a' });
    expect(h.catalog.snapshot().projects.map((project) => project.id)).toEqual(['project-a']);
    await h.owner.close();
  });
});

describe('Playground catalog baseline provenance', () => {
  it('preserves a dirty exact-baseline Scratch as an identity-level no-op', async () => {
    let now = '2026-07-16T12:00:00.000Z';
    const h = await harness(new MemoryFsSync(), () => now);
    await h.catalog.createScratch({ definition: definition('scratch') });
    const scratch = await h.owner.openProject(definition('scratch'));
    h.authority.writeFileSync(
      `${scratch.projectRoot}/src/main.ts`,
      encoder.encode('user-owned dirty bytes'),
    );
    h.authority.writeFileSync(`${scratch.projectRoot}/user.txt`, encoder.encode('keep me'));
    await h.owner.recordMutation({
      kind: 'guest',
      project: scratch,
      treeRevision: h.owner.treeRevision(),
    });
    const beforeTree = treeFiles(h.fs, scratch.projectRoot);
    await close(scratch);

    const before = h.catalog.snapshot();
    expect(before.scratch).toEqual({
      starterId: 'starter-a',
      dirty: true,
      editedAt: '2026-07-16T12:00:00.000Z',
    });
    const observed: PlaygroundCatalogSnapshot[] = [];
    const unsubscribe = h.catalog.subscribe((snapshot) => observed.push(snapshot));
    now = '2026-07-17T13:00:00.000Z';

    const preserved = await h.catalog.createScratch({
      definition: definition('scratch'),
      preserveDirtySameStarter: true,
    });

    expect(preserved).toBe(before);
    expect(h.catalog.snapshot()).toBe(before);
    expect(observed).toEqual([before]);
    const reopened = await h.owner.openProject(definition('scratch'));
    expect(treeFiles(h.fs, reopened.projectRoot)).toEqual(beforeTree);
    expect(decoder.decode(h.fs.readFileBytesSync(`${reopened.projectRoot}/src/main.ts`))).toBe(
      'user-owned dirty bytes',
    );
    expect(decoder.decode(h.fs.readFileBytesSync(`${reopened.projectRoot}/user.txt`))).toBe(
      'keep me',
    );
    await close(reopened);

    unsubscribe();
    await h.owner.close();
  });

  it.each([
    {
      case: 'the flag is false',
      preserveDirtySameStarter: false,
      candidate: definition('scratch'),
      expectedStarterId: 'starter-a',
      expectedMain: 'document.body.dataset.ready = "yes";\n',
    },
    {
      case: 'the baseline differs under the same Starter id',
      preserveDirtySameStarter: true,
      candidate: definition('scratch', 'starter-a', {
        files: { '/src/main.ts': 'same Starter, replacement baseline\n' },
      }),
      expectedStarterId: 'starter-a',
      expectedMain: 'same Starter, replacement baseline\n',
    },
    {
      case: 'the Starter id differs',
      preserveDirtySameStarter: true,
      candidate: definition('scratch', 'starter-b', {
        files: { '/src/main.ts': 'different Starter baseline\n' },
      }),
      expectedStarterId: 'starter-b',
      expectedMain: 'different Starter baseline\n',
    },
  ])('re-seeds a dirty Scratch when $case', async (testCase) => {
    let now = '2026-07-16T12:00:00.000Z';
    const h = await harness(new MemoryFsSync(), () => now);
    await h.catalog.createScratch({ definition: definition('scratch') });
    const scratch = await h.owner.openProject(definition('scratch'));
    h.authority.writeFileSync(`${scratch.projectRoot}/src/main.ts`, encoder.encode('dirty bytes'));
    h.authority.writeFileSync(`${scratch.projectRoot}/user.txt`, encoder.encode('remove me'));
    await h.owner.recordMutation({
      kind: 'guest',
      project: scratch,
      treeRevision: h.owner.treeRevision(),
    });
    await close(scratch);
    const before = h.catalog.snapshot();
    expect(before.scratch?.dirty).toBe(true);
    const observed: PlaygroundCatalogSnapshot[] = [];
    const unsubscribe = h.catalog.subscribe((snapshot) => observed.push(snapshot));
    now = '2026-07-17T13:00:00.000Z';

    const reseeded = await h.catalog.createScratch({
      definition: testCase.candidate,
      preserveDirtySameStarter: testCase.preserveDirtySameStarter,
    });

    expect(reseeded).not.toBe(before);
    expect(reseeded.scratch).toEqual({
      starterId: testCase.expectedStarterId,
      dirty: false,
      editedAt: '2026-07-17T13:00:00.000Z',
    });
    expect(observed).toEqual([before, reseeded]);
    const opened = await h.owner.openProject(testCase.candidate);
    expect(h.fs.existsSync(`${opened.projectRoot}/user.txt`)).toBe(false);
    expect(decoder.decode(h.fs.readFileBytesSync(`${opened.projectRoot}/src/main.ts`))).toBe(
      testCase.expectedMain,
    );
    await close(opened);

    unsubscribe();
    await h.owner.close();
  });

  it('re-seeds a clean exact-baseline Scratch even when preservation is requested', async () => {
    let now = '2026-07-16T12:00:00.000Z';
    const h = await harness(new MemoryFsSync(), () => now);
    const before = await h.catalog.createScratch({ definition: definition('scratch') });
    const observed: PlaygroundCatalogSnapshot[] = [];
    const unsubscribe = h.catalog.subscribe((snapshot) => observed.push(snapshot));
    now = '2026-07-17T13:00:00.000Z';

    const reseeded = await h.catalog.createScratch({
      definition: definition('scratch'),
      preserveDirtySameStarter: true,
    });

    expect(reseeded).not.toBe(before);
    expect(reseeded.scratch).toEqual({
      starterId: 'starter-a',
      dirty: false,
      editedAt: '2026-07-17T13:00:00.000Z',
    });
    expect(observed).toEqual([before, reseeded]);

    unsubscribe();
    await h.owner.close();
  });

  it('lets durable id vary on Save, rejects every Starter-baseline drift, and leaves Scratch exact on rejection', async () => {
    const h = await harness();
    await h.catalog.createScratch({ definition: definition('scratch') });
    const scratch = await h.owner.openProject(definition('scratch'));
    h.authority.mkdirSync(`${scratch.projectRoot}/notes`, { recursive: true });
    h.authority.writeFileSync(
      `${scratch.projectRoot}/notes/user.txt`,
      encoder.encode('user bytes'),
    );
    await h.owner.recordMutation({
      kind: 'guest',
      project: scratch,
      treeRevision: h.owner.treeRevision(),
    });
    await close(scratch);

    const before = h.catalog.snapshot();
    expect(before.scratch?.dirty).toBe(true);
    const mismatches = [
      definition('project-a', 'starter-b'),
      definition('project-a', 'starter-a', { templateId: 'vite-template-v2' }),
      definition('project-a', 'starter-a', {
        files: { '/index.html': '<main>different baseline</main>\n' },
      }),
      definition('project-a', 'starter-a', { port: 5174 }),
      definition('project-a', 'starter-a', {
        firstMaterialization: {
          kind: 'snapshot',
          snapshot: {
            snapshotId: `sha256:${'a'.repeat(64)}`,
            assetUrl: '/snapshots/vite.json',
            templateId: 'vite-template-v1',
          },
        },
      }),
    ];

    for (const candidate of mismatches) {
      await expect(
        h.catalog.saveScratch({ id: 'project-a', name: 'Project A', definition: candidate }),
      ).rejects.toBeInstanceOf(ProjectDefinitionMismatchError);
      expect(h.catalog.snapshot()).toBe(before);
    }

    await h.catalog.saveScratch({
      id: 'project-a',
      name: 'Project A',
      definition: definition('project-a'),
    });
    const opened = await h.owner.openProject(definition('project-a'));
    expect(decoder.decode(h.fs.readFileBytesSync(`${opened.projectRoot}/notes/user.txt`))).toBe(
      'user bytes',
    );
    await close(opened);
    await h.owner.close();
  });

  it('fingerprints dependency sections and every finite runtime field without a lossy projection', async () => {
    const files = Object.freeze({
      '/entry-a.mjs': 'export const entry = "a";\n',
      '/entry-b.mjs': 'export const entry = "b";\n',
      '/package.json': '{"name":"identity-contract","version":"1.0.0"}\n',
    });
    const materialization = Object.freeze({ kind: 'install' as const });
    const vite = (id: string, overrides: Partial<VitePlaygroundPlan> = {}): VitePlaygroundPlan => ({
      kind: 'vite',
      id,
      starterId: 'identity-starter',
      templateId: 'identity-template',
      files,
      dependencies: { kleur: '4.1.5' },
      devDependencies: { typescript: '5.9.3' },
      port: 5173,
      viteVersion: '8.0.0',
      firstMaterialization: materialization,
      ...overrides,
    });
    const server = (
      id: string,
      overrides: Partial<NodeServerPlaygroundPlan> = {},
    ): NodeServerPlaygroundPlan => ({
      kind: 'node-server',
      id,
      starterId: 'identity-starter',
      templateId: 'identity-template',
      files,
      dependencies: { kleur: '4.1.5' },
      devDependencies: { typescript: '5.9.3' },
      entryPath: '/entry-a.mjs',
      port: 5173,
      firstMaterialization: materialization,
      ...overrides,
    });
    const cli = (
      id: string,
      overrides: Partial<NodeCliPlaygroundPlan> = {},
    ): NodeCliPlaygroundPlan => ({
      kind: 'node-cli',
      id,
      starterId: 'identity-starter',
      templateId: 'identity-template',
      files,
      dependencies: { kleur: '4.1.5' },
      devDependencies: { typescript: '5.9.3' },
      entryPath: '/entry-a.mjs',
      args: ['--mode', 'a'],
      firstMaterialization: materialization,
      ...overrides,
    });
    const cases: readonly {
      readonly name: string;
      readonly initial: PlaygroundProjectPlan;
      readonly mismatches: readonly PlaygroundProjectPlan[];
    }[] = [
      {
        name: 'Vite dependency sections, version and runtime kind',
        initial: vite('scratch'),
        mismatches: [
          vite('project-a', { dependencies: { kleur: '4.1.4' } }),
          vite('project-a', { devDependencies: { typescript: '5.9.2' } }),
          vite('project-a', {
            dependencies: {},
            devDependencies: { typescript: '5.9.3', kleur: '4.1.5' },
          }),
          vite('project-a', { viteVersion: '8.1.0' }),
          server('project-a'),
        ],
      },
      {
        name: 'Node server entry and port',
        initial: server('scratch'),
        mismatches: [
          server('project-a', { entryPath: '/entry-b.mjs' }),
          server('project-a', { port: 5174 }),
        ],
      },
      {
        name: 'Node CLI entry and arguments',
        initial: cli('scratch'),
        mismatches: [
          cli('project-a', { entryPath: '/entry-b.mjs' }),
          cli('project-a', { args: ['--mode', 'b'] }),
          cli('project-a', { args: [] }),
        ],
      },
    ];

    for (const testCase of cases) {
      const h = await harness();
      await h.catalog.createScratch({ definition: projectDefinition(testCase.initial) });
      const before = h.catalog.snapshot();
      for (const candidate of testCase.mismatches) {
        await expect(
          h.catalog.saveScratch({
            id: 'project-a',
            name: testCase.name,
            definition: projectDefinition(candidate),
          }),
        ).rejects.toBeInstanceOf(ProjectDefinitionMismatchError);
        expect(h.catalog.snapshot()).toBe(before);
      }
      await h.owner.close();
    }
  });

  it('excludes snapshot asset location from baseline identity but includes snapshot provenance', async () => {
    const h = await harness();
    const snapshotId = `sha256:${'a'.repeat(64)}`;
    const initialMaterialization = {
      kind: 'snapshot' as const,
      snapshot: {
        snapshotId,
        assetUrl: '/snapshots/vite-node-modules.json.gz',
        templateId: 'vite-template-v1',
      },
    };
    await h.catalog.createScratch({
      definition: definition('scratch', 'starter-a', {
        firstMaterialization: initialMaterialization,
      }),
    });

    const before = h.catalog.snapshot();
    for (const firstMaterialization of [
      {
        kind: 'snapshot' as const,
        snapshot: {
          snapshotId: `sha256:${'b'.repeat(64)}`,
          assetUrl: '/snapshots/vite-node-modules.json.gz',
          templateId: 'vite-template-v1',
        },
      },
      {
        kind: 'snapshot' as const,
        snapshot: {
          snapshotId,
          assetUrl: '/snapshots/vite-node-modules.json.gz',
          templateId: 'shared-vite-dependencies-v2',
        },
      },
    ]) {
      await expect(
        h.catalog.saveScratch({
          id: 'project-a',
          name: 'Project A',
          definition: definition('project-a', 'starter-a', { firstMaterialization }),
        }),
      ).rejects.toBeInstanceOf(ProjectDefinitionMismatchError);
      expect(h.catalog.snapshot()).toBe(before);
    }

    await h.catalog.saveScratch({
      id: 'project-a',
      name: 'Project A',
      definition: definition('project-a', 'starter-a', {
        firstMaterialization: {
          ...initialMaterialization,
          snapshot: {
            ...initialMaterialization.snapshot,
            assetUrl: '/relocated/vite-node-modules.json.gz',
          },
        },
      }),
    });
    expect(h.catalog.snapshot().active).toEqual({ kind: 'project', id: 'project-a' });
    await h.owner.close();
  });

  it('allows only Reset to replace a Scratch or project baseline and re-seeds the whole tree', async () => {
    const h = await harness();
    await h.catalog.createScratch({ definition: definition('scratch') });
    const scratch = await h.owner.openProject(definition('scratch'));
    h.authority.writeFileSync(`${scratch.projectRoot}/stray.txt`, encoder.encode('remove me'));
    await h.owner.recordMutation({
      kind: 'guest',
      project: scratch,
      treeRevision: h.owner.treeRevision(),
    });
    await close(scratch);

    const scratchB = definition('scratch', 'starter-b', {
      files: { '/src/main.ts': 'console.log("starter b");\n' },
      templateId: 'vite-template-v2',
      port: 5174,
    });
    await h.catalog.reset({ target: { kind: 'scratch' }, definition: scratchB });
    expect(h.catalog.snapshot().scratch).toEqual({
      starterId: 'starter-b',
      dirty: false,
      editedAt: EDITED_AT,
    });
    const resetScratch = await h.owner.openProject(scratchB);
    expect(h.fs.existsSync(`${resetScratch.projectRoot}/stray.txt`)).toBe(false);
    expect(decoder.decode(h.fs.readFileBytesSync(`${resetScratch.projectRoot}/src/main.ts`))).toBe(
      'console.log("starter b");\n',
    );
    await close(resetScratch);

    await h.catalog.saveScratch({
      id: 'project-b',
      name: 'Project B',
      definition: definition('project-b', 'starter-b', {
        files: { '/src/main.ts': 'console.log("starter b");\n' },
        templateId: 'vite-template-v2',
        port: 5174,
      }),
    });
    const projectC = definition('project-b', 'starter-c', {
      files: { '/src/main.ts': 'console.log("starter c");\n' },
      templateId: 'vite-template-v3',
      port: 5175,
    });
    await h.catalog.reset({
      target: { kind: 'project', id: 'project-b' },
      definition: projectC,
    });
    expect(h.catalog.snapshot().projects[0]).toEqual({
      id: 'project-b',
      name: 'Project B',
      starterId: 'starter-c',
      editedAt: EDITED_AT,
    });
    const resetProject = await h.owner.openProject(projectC);
    expect(decoder.decode(h.fs.readFileBytesSync(`${resetProject.projectRoot}/src/main.ts`))).toBe(
      'console.log("starter c");\n',
    );
    await close(resetProject);
    await h.owner.close();
  });
});

describe('Playground catalog single owner and busy gate', () => {
  it('acknowledges an exact project-rooted terminal seed from the real owner tree', async () => {
    const h = await harness();
    await h.catalog.createScratch({ definition: definition('scratch') });
    const env = { PATH: '/bin', RIFTY_OWNER_TOKEN: 'opaque-guest-data' };
    const requested = { cwd: '/src', env };

    const opening = h.owner.openProject(definition('scratch'), requested);
    requested.cwd = '/mutated-after-admission';
    env.PATH = '/mutated-after-admission';
    const opened = await opening;

    expect(opened.initialTerminalState).toEqual({
      cwd: '/src',
      env: { PATH: '/bin', RIFTY_OWNER_TOKEN: 'opaque-guest-data' },
    });
    expect(Object.isFrozen(opened.initialTerminalState)).toBe(true);
    expect(Object.isFrozen(opened.initialTerminalState?.env)).toBe(true);
    await close(opened);

    const stale = await h.owner.openProject(definition('scratch'), {
      cwd: '/deleted',
      env: { KEEP: 'yes', RIFTY_OWNER_TOKEN: 'still-guest-data' },
    });
    expect(stale.initialTerminalState).toEqual({
      cwd: '/',
      env: { KEEP: 'yes', RIFTY_OWNER_TOKEN: 'still-guest-data' },
    });
    await close(stale);
    await h.owner.close();
  });

  it.each([
    ['guest', '/mutation-guest.txt', true],
    ['scm', '/.git/index', true],
    ['archive', '/archive.txt', true],
    ['file', '/file.txt', true],
    ['package-manifest', '/package.json', true],
    ['package-lock', '/package-lock.json', true],
    ['seed', '/seed.txt', false],
    ['dependency', '/node_modules/pkg/index.js', false],
    ['reserved-authority', null, false],
  ] as const)(
    'classifies a %s mutation before the originating operation settles',
    async (kind, relativePath, expectedDirty) => {
      const h = await harness();
      await h.catalog.createScratch({ definition: definition('scratch') });
      const opened = await h.owner.openProject(definition('scratch'));
      const observed: boolean[] = [];
      const events: string[] = [];
      h.catalog.subscribe((snapshot) => {
        const dirty = snapshot.scratch?.dirty ?? false;
        observed.push(dirty);
        if (dirty) events.push('published');
      });

      if (relativePath === null) {
        h.installStampClaims.write(opened.projectRoot, encoder.encode('owner claim'), {
          mkdirTree: true,
        });
      } else {
        const path = `${opened.projectRoot}${relativePath}`;
        h.authority.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
        h.authority.writeFileSync(path, encoder.encode(kind));
      }
      const reflected = h.owner.recordMutation({
        kind,
        project: opened,
        treeRevision: h.owner.treeRevision(),
      });
      void reflected.then(() => events.push('resolved'));
      await reflected;

      expect(h.catalog.snapshot().scratch?.dirty).toBe(expectedDirty);
      expect(observed).toEqual(expectedDirty ? [false, true] : [false]);
      expect(events).toEqual(expectedDirty ? ['published', 'resolved'] : ['resolved']);

      await close(opened);
      await h.owner.close();
    },
  );

  it('gates tree-changing catalog/root operations while live, allows rename, and routes both delete surfaces through the same state owner', async () => {
    const h = await harness();
    await h.catalog.createScratch({ definition: definition('scratch') });
    await h.catalog.saveScratch({
      id: 'project-a',
      name: 'Project A',
      definition: definition('project-a'),
    });
    const opened = await h.owner.openProject(definition('project-a'));

    const blocked = [
      h.catalog.createScratch({ definition: definition('scratch') }),
      h.catalog.saveScratch({
        id: 'project-b',
        name: 'Project B',
        definition: definition('project-b'),
      }),
      h.catalog.activate({ kind: 'project', id: 'project-a' }),
      h.catalog.reset({
        target: { kind: 'project', id: 'project-a' },
        definition: definition('project-a'),
      }),
      h.catalog.delete('project-a'),
      h.owner.deleteProject('project-a'),
    ];
    for (const operation of blocked)
      await expect(operation).rejects.toBeInstanceOf(ProjectBusyError);

    await h.catalog.rename('project-a', 'Renamed while live');
    expect(h.catalog.snapshot().projects[0]?.name).toBe('Renamed while live');
    await close(opened);
    await h.owner.deleteProject('project-a');
    expect(h.catalog.snapshot()).toEqual(EMPTY);

    await h.catalog.createScratch({ definition: definition('scratch') });
    await h.catalog.saveScratch({
      id: 'project-b',
      name: 'Project B',
      definition: definition('project-b'),
    });
    await h.catalog.delete('project-b');
    expect(h.catalog.snapshot()).toEqual(EMPTY);
    await h.owner.close();
  });

  it('catalog-gates root open by active ref, exact Starter baseline, and same-companion provenance', async () => {
    const h = await harness();
    await h.catalog.createScratch({ definition: definition('scratch') });
    await h.catalog.saveScratch({
      id: 'project-a',
      name: 'Project A',
      definition: definition('project-a'),
    });
    await h.catalog.createScratch({ definition: definition('scratch') });

    await expect(h.owner.openProject(definition('project-a'))).rejects.toThrow();
    await expect(
      h.owner.openProject(
        definition('scratch', 'starter-a', {
          files: { '/index.html': '<main>forged baseline</main>\n' },
        }),
      ),
    ).rejects.toBeInstanceOf(ProjectDefinitionMismatchError);
    const rootDefinition = definePlaygroundProject(
      plan('scratch'),
      Object.freeze({
        apiBaseUrl: 'https://other.invalid/app/',
        clientUrl: 'https://other.invalid/app/index.html',
      }),
    );
    await expect(h.owner.openProject(rootDefinition)).rejects.toThrow(TypeError);

    const opened = await h.owner.openProject(definition('scratch'));
    await close(opened);
    await h.owner.close();
  });
});

describe('Playground catalog crash recovery', () => {
  it.each(catalogMutationCases())(
    '$name survives every $fault persisted primitive, hard restart, retry, and second restart',
    async (testCase) => {
      const baselineFs = new DurableOwnerFs();
      const baseline = await harness(baselineFs);
      await testCase.prepare(baseline);
      expect(baselineFs.pendingPrimitiveCount).toBe(0);
      expect(baselineFs.liveSnapshot()).toEqual(baselineFs.durableSnapshot());
      const expectedPre = Object.freeze({
        catalog: baseline.catalog.snapshot(),
        tree: baselineFs.durableSnapshot(),
      });

      const canonicalPostFs = baselineFs.restartFromDurableState();
      const canonicalPost = await harness(canonicalPostFs);
      await testCase.mutate(canonicalPost);
      expect(canonicalPostFs.pendingPrimitiveCount).toBe(0);
      expect(canonicalPostFs.liveSnapshot()).toEqual(canonicalPostFs.durableSnapshot());
      const expectedPost = Object.freeze({
        catalog: canonicalPost.catalog.snapshot(),
        tree: canonicalPostFs.durableSnapshot(),
      });

      let exhausted = false;
      let rejectedFaults = 0;
      let sawInteriorPartialPersistence = false;
      let recoveredPreStates = 0;
      let recoveredPostStates = 0;
      for (let failAt = 1; failAt <= 200; failAt += 1) {
        const fs = baselineFs.restartFromDurableState();
        const h = await harness(fs);
        const before = h.catalog.snapshot();
        expect(before).toEqual(expectedPre.catalog);
        expect(fs.liveSnapshot()).toEqual(expectedPre.tree);
        expect(fs.durableSnapshot()).toEqual(expectedPre.tree);
        const observed: PlaygroundCatalogSnapshot[] = [];
        const unsubscribe = h.catalog.subscribe((snapshot) => observed.push(snapshot));
        fs.armPersistFailure(failAt, testCase.fault);

        const outcome = await testCase.mutate(h).then(
          (catalog) => Object.freeze({ kind: 'resolved' as const, catalog }),
          (error: unknown) => Object.freeze({ kind: 'rejected' as const, error }),
        );
        fs.disarmPersistFailure();
        expect(fs.pendingPrimitiveCount).toBe(0);

        if (!fs.didInjectFailure) {
          expect(outcome.kind).toBe('resolved');
          expect(fs.persistPrimitiveCount).toBeLessThan(failAt);
          expectCatalogState(h, fs, expectedPost);
          expect(observed).toEqual([expectedPre.catalog, expectedPost.catalog]);
          await expectEveryCatalogCrashBoundary(
            testCase,
            fs.durabilityBoundaries,
            expectedPre,
            expectedPost,
          );
          await expectHardRestartState(fs, expectedPost);
          unsubscribe();
          exhausted = true;
          break;
        }

        const injectedIndex = fs.trace.findIndex((entry) => entry.outcome === 'injected-failure');
        expect(injectedIndex).toBeGreaterThanOrEqual(0);
        if (
          fs.trace.slice(0, injectedIndex).some((entry) => entry.outcome === 'success') &&
          fs.trace.slice(injectedIndex + 1).some((entry) => entry.outcome === 'success')
        ) {
          sawInteriorPartialPersistence = true;
        }

        expect(outcome.kind).toBe('rejected');
        if (outcome.kind !== 'rejected') {
          unsubscribe();
          throw new Error(
            `${testCase.name} resolved after injected ${testCase.fault} ordinal ${String(failAt)}`,
          );
        }

        rejectedFaults += 1;
        expect(outcome.error).toBeInstanceOf(Error);
        expect(String(outcome.error)).toMatch(
          testCase.fault === 'permission-rejection' ? /permission/i : /persistence|quota/i,
        );
        expect(h.catalog.snapshot()).toBe(before);
        expect(observed).toEqual([before]);
        const faultBoundaries = fs.durabilityBoundaries;
        const finalFaultTree = fs.durableSnapshot();

        const recoveryCounts = await expectEveryCatalogCrashBoundary(
          testCase,
          faultBoundaries,
          expectedPre,
          expectedPost,
        );
        recoveredPreStates += recoveryCounts.pre;
        recoveredPostStates += recoveryCounts.post;

        await testCase.mutate(h);
        expectCatalogState(h, fs, expectedPost);
        expect(observed).toEqual([expectedPre.catalog, expectedPost.catalog]);
        await expectHardRestartState(fs, expectedPost);
        unsubscribe();

        const recoveredFs = createDurableOwnerFsFromTree(finalFaultTree);
        const recovered = await harness(recoveredFs);
        const recoveredState = classifyCatalogState(
          recovered,
          recoveredFs,
          expectedPre,
          expectedPost,
        );
        expect(recoveredState).not.toBe('neither');
        expect(recoveredFs.pendingPrimitiveCount).toBe(0);
        expect(recoveredFs.liveSnapshot()).toEqual(recoveredFs.durableSnapshot());

        if (recoveredState === 'pre') {
          recoveredPreStates += 1;
          await testCase.mutate(recovered);
        } else if (recoveredState === 'post') {
          recoveredPostStates += 1;
        }
        expectCatalogState(recovered, recoveredFs, expectedPost);
        await expectHardRestartState(recoveredFs, expectedPost);
      }

      expect(exhausted).toBe(true);
      expect(rejectedFaults).toBeGreaterThan(0);
      expect(sawInteriorPartialPersistence).toBe(true);
      expect(recoveredPreStates).toBeGreaterThan(0);
      expect(recoveredPostStates).toBeGreaterThan(0);
    },
  );
});

interface CatalogMutationCase {
  readonly name: string;
  readonly fault: DurableOwnerFault;
  prepare(harness: CatalogHarness): Promise<void>;
  mutate(harness: CatalogHarness): Promise<PlaygroundCatalogSnapshot>;
}

interface ExactCatalogState {
  readonly catalog: PlaygroundCatalogSnapshot;
  readonly tree: ExactFsTree;
}

function catalogMutationCases(): readonly CatalogMutationCase[] {
  const operations = Object.freeze([
    {
      name: 'createScratch',
      prepare: async (_h: CatalogHarness) => {},
      mutate: (h: CatalogHarness) => h.catalog.createScratch({ definition: definition('scratch') }),
    },
    {
      name: 'saveScratch',
      prepare: async (h: CatalogHarness) => {
        await h.catalog.createScratch({ definition: definition('scratch') });
      },
      mutate: (h: CatalogHarness) =>
        h.catalog.saveScratch({
          id: 'project-a',
          name: 'Project A',
          definition: definition('project-a'),
        }),
    },
    {
      name: 'activate',
      prepare: async (h: CatalogHarness) => {
        await h.catalog.createScratch({ definition: definition('scratch') });
        await h.catalog.saveScratch({
          id: 'project-a',
          name: 'Project A',
          definition: definition('project-a'),
        });
        await h.catalog.createScratch({ definition: definition('scratch') });
      },
      mutate: (h: CatalogHarness) => h.catalog.activate({ kind: 'project', id: 'project-a' }),
    },
    {
      name: 'rename',
      prepare: async (h: CatalogHarness) => {
        await h.catalog.createScratch({ definition: definition('scratch') });
        await h.catalog.saveScratch({
          id: 'project-a',
          name: 'Project A',
          definition: definition('project-a'),
        });
      },
      mutate: (h: CatalogHarness) => h.catalog.rename('project-a', 'Renamed'),
    },
    {
      name: 'reset',
      prepare: async (h: CatalogHarness) => {
        await h.catalog.createScratch({ definition: definition('scratch') });
        await h.catalog.saveScratch({
          id: 'project-a',
          name: 'Project A',
          definition: definition('project-a'),
        });
      },
      mutate: (h: CatalogHarness) =>
        h.catalog.reset({
          target: { kind: 'project', id: 'project-a' },
          definition: definition('project-a', 'starter-b', {
            files: { '/reset.txt': 'new baseline' },
          }),
        }),
    },
    {
      name: 'delete',
      prepare: async (h: CatalogHarness) => {
        await h.catalog.createScratch({ definition: definition('scratch') });
        await h.catalog.saveScratch({
          id: 'project-a',
          name: 'Project A',
          definition: definition('project-a'),
        });
      },
      mutate: (h: CatalogHarness) => h.catalog.delete('project-a'),
    },
  ] as const);

  return Object.freeze(
    operations.flatMap((operation) =>
      (['quota-report', 'permission-rejection'] as const).map((fault) =>
        Object.freeze({ ...operation, name: `${operation.name} × ${fault}`, fault }),
      ),
    ),
  );
}

function exactTreesEqual(left: ExactFsTree, right: ExactFsTree): boolean {
  if (left.directories.length !== right.directories.length) return false;
  if (left.directories.some((directory, index) => directory !== right.directories[index])) {
    return false;
  }
  const leftPaths = Object.keys(left.files);
  const rightPaths = Object.keys(right.files);
  if (leftPaths.length !== rightPaths.length) return false;
  for (let index = 0; index < leftPaths.length; index += 1) {
    const leftPath = leftPaths[index];
    const rightPath = rightPaths[index];
    if (leftPath === undefined || rightPath === undefined || leftPath !== rightPath) return false;
    const leftBytes = left.files[leftPath];
    const rightBytes = right.files[rightPath];
    if (leftBytes === undefined || rightBytes === undefined) return false;
    if (leftBytes.length !== rightBytes.length) return false;
    if (leftBytes.some((byte, byteIndex) => byte !== rightBytes[byteIndex])) return false;
  }
  return true;
}

function catalogSnapshotsEqual(
  left: PlaygroundCatalogSnapshot,
  right: PlaygroundCatalogSnapshot,
): boolean {
  const activeEqual =
    left.active === right.active ||
    (left.active !== null &&
      right.active !== null &&
      left.active.kind === right.active.kind &&
      (left.active.kind === 'scratch' ||
        (right.active.kind === 'project' && left.active.id === right.active.id)));
  const scratchEqual =
    left.scratch === right.scratch ||
    (left.scratch !== null &&
      right.scratch !== null &&
      left.scratch.starterId === right.scratch.starterId &&
      left.scratch.dirty === right.scratch.dirty &&
      left.scratch.editedAt === right.scratch.editedAt);
  return (
    activeEqual &&
    scratchEqual &&
    left.projects.length === right.projects.length &&
    left.projects.every((project, index) => {
      const candidate = right.projects[index];
      return (
        candidate !== undefined &&
        project.id === candidate.id &&
        project.name === candidate.name &&
        project.starterId === candidate.starterId &&
        project.editedAt === candidate.editedAt
      );
    })
  );
}

function classifyCatalogState(
  h: CatalogHarness,
  fs: DurableOwnerFs,
  expectedPre: ExactCatalogState,
  expectedPost: ExactCatalogState,
): 'pre' | 'post' | 'neither' {
  const snapshot = h.catalog.snapshot();
  const tree = fs.durableSnapshot();
  if (
    catalogSnapshotsEqual(snapshot, expectedPre.catalog) &&
    exactTreesEqual(tree, expectedPre.tree)
  ) {
    return 'pre';
  }
  if (
    catalogSnapshotsEqual(snapshot, expectedPost.catalog) &&
    exactTreesEqual(tree, expectedPost.tree)
  ) {
    return 'post';
  }
  return 'neither';
}

function expectCatalogState(
  h: CatalogHarness,
  fs: DurableOwnerFs,
  expected: ExactCatalogState,
): void {
  expect(h.catalog.snapshot()).toEqual(expected.catalog);
  expect(fs.liveSnapshot()).toEqual(expected.tree);
  expect(fs.durableSnapshot()).toEqual(expected.tree);
  expect(fs.pendingPrimitiveCount).toBe(0);
}

async function expectHardRestartState(
  fs: DurableOwnerFs,
  expected: ExactCatalogState,
): Promise<void> {
  const restartedFs = fs.restartFromDurableState();
  const restarted = await harness(restartedFs);
  expectCatalogState(restarted, restartedFs, expected);
}

async function expectEveryCatalogCrashBoundary(
  testCase: CatalogMutationCase,
  boundaries: readonly { readonly durableState: ExactFsTree }[],
  expectedPre: ExactCatalogState,
  expectedPost: ExactCatalogState,
): Promise<{ readonly pre: number; readonly post: number }> {
  expect(boundaries.length).toBeGreaterThan(0);
  let pre = 0;
  let post = 0;
  for (const boundary of boundaries) {
    const recoveredFs = createDurableOwnerFsFromTree(boundary.durableState);
    const recovered = await harness(recoveredFs);
    const state = classifyCatalogState(recovered, recoveredFs, expectedPre, expectedPost);
    expect(state).not.toBe('neither');
    expect(recoveredFs.pendingPrimitiveCount).toBe(0);
    expect(recoveredFs.liveSnapshot()).toEqual(recoveredFs.durableSnapshot());
    if (state === 'pre') {
      pre += 1;
      await testCase.mutate(recovered);
    } else if (state === 'post') {
      post += 1;
    }
    expectCatalogState(recovered, recoveredFs, expectedPost);
    await expectHardRestartState(recoveredFs, expectedPost);
  }
  return Object.freeze({ pre, post });
}
