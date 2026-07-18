import { describe, expect, it, vi } from 'vitest';
import { inspectProjectDefinition, projects } from './project-definition.ts';
import {
  ClosedHandleError,
  ProjectDefinitionMismatchError,
  createProjectMaterializer,
} from './project-materialization.ts';

type ProjectMaterializerDependencies = Parameters<typeof createProjectMaterializer>[0];

interface ProjectRecord {
  readonly definitionIdentity: string;
  readonly projectRoot: string;
  readonly revision: number;
  readonly files: Map<string, Uint8Array>;
}

interface StageRecord {
  readonly stageId: string;
  readonly projectKey: string;
  readonly files: Map<string, Uint8Array>;
}

interface AcquisitionRequest {
  readonly projectKey: string;
  readonly projectRoot: string;
  readonly definition: unknown;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error('condition did not become true');
}

async function settledOr<T>(promise: Promise<T>, pending: T): Promise<T> {
  return Promise.race([promise, Promise.resolve().then(() => pending)]);
}

function viteDefinition(
  id: string,
  files: Readonly<Record<string, string | Uint8Array>> = {
    '/src/main.ts': "document.body.textContent = 'seed'",
  },
) {
  return inspectProjectDefinition(
    projects.vite({
      id,
      files,
      dependencies: { nanoid: '5.1.5' },
      devDependencies: { typescript: '5.9.2' },
    }),
  );
}

function materializationHarness() {
  const records = new Map<string, ProjectRecord>();
  const stages = new Map<string, StageRecord>();
  const events: string[] = [];
  let nextStage = 1;
  let nextRevision = 1;
  let writeCount = 0;
  let failWriteAt: number | undefined;
  let writeGate: ReturnType<typeof deferred<void>> | undefined;
  let durabilityGate: ReturnType<typeof deferred<void>> | undefined;
  let durabilityFailure: unknown;
  let acquisitionGate: ReturnType<typeof deferred<void>> | undefined;
  let discardFailure: unknown;

  const readProject = vi.fn(async (projectKey: string) => {
    events.push(`read:${projectKey}`);
    const record = records.get(projectKey);
    if (record === undefined) return null;
    return {
      definitionIdentity: record.definitionIdentity,
      projectRoot: record.projectRoot,
      revision: record.revision,
    };
  });

  const discardStage = vi.fn(async (projectKey: string): Promise<void> => {
    events.push(`discard:${projectKey}`);
    if (discardFailure !== undefined) throw discardFailure;
    for (const [stageId, stage] of stages) {
      if (stage.projectKey === projectKey) stages.delete(stageId);
    }
  });

  const beginStage = vi.fn(async (projectKey: string) => {
    events.push(`begin:${projectKey}`);
    const existing = [...stages.values()].find((stage) => stage.projectKey === projectKey);
    if (existing !== undefined) {
      throw new Error(`stale stage must be discarded before begin: ${existing.stageId}`);
    }
    const stageId = `stage-${nextStage}`;
    nextStage += 1;
    stages.set(stageId, { stageId, projectKey, files: new Map() });
    return { stageId };
  });

  const writeStageFile = vi.fn(
    async (stageId: string, path: string, bytes: Uint8Array): Promise<void> => {
      const stage = stages.get(stageId);
      if (stage === undefined) throw new Error(`unknown stage: ${stageId}`);
      events.push(`write:${stage.projectKey}:${path}`);
      const held = writeGate;
      writeGate = undefined;
      if (held !== undefined) await held.promise;
      stage.files.set(path, bytes.slice());
      writeCount += 1;
      if (failWriteAt === writeCount) {
        failWriteAt = undefined;
        throw new Error('injected stage interruption');
      }
    },
  );

  const promoteStage = vi.fn(
    async (input: {
      readonly stageId: string;
      readonly projectKey: string;
      readonly definitionIdentity: string;
    }) => {
      const stage = stages.get(input.stageId);
      if (stage === undefined || stage.projectKey !== input.projectKey) {
        throw new Error(`invalid stage promotion: ${input.stageId}`);
      }
      events.push(`promote:${input.projectKey}`);
      const revision = nextRevision;
      nextRevision += 1;
      const projectRoot = `/.rifty/projects/${input.projectKey}`;
      records.set(input.projectKey, {
        definitionIdentity: input.definitionIdentity,
        projectRoot,
        revision,
        files: new Map([...stage.files].map(([path, bytes]) => [path, bytes.slice()] as const)),
      });
      stages.delete(input.stageId);
      return { projectRoot, revision };
    },
  );

  const deleteProject = vi.fn(async (projectKey: string) => {
    events.push(`delete:${projectKey}`);
    records.delete(projectKey);
    for (const [stageId, stage] of stages) {
      if (stage.projectKey === projectKey) stages.delete(stageId);
    }
    const revision = nextRevision;
    nextRevision += 1;
    return { revision };
  });

  const waitForDurability = vi.fn(
    async (input: { readonly projectKey: string; readonly revision: number }): Promise<void> => {
      events.push(`durability:${input.revision}`);
      const held = durabilityGate;
      durabilityGate = undefined;
      if (held !== undefined) await held.promise;
      const failure = durabilityFailure;
      durabilityFailure = undefined;
      if (failure !== undefined) throw failure;
    },
  );

  const owner = {
    readProject,
    discardStage,
    beginStage,
    writeStageFile,
    promoteStage,
    deleteProject,
    waitForDurability,
  };

  const ensure = vi.fn(async (request: AcquisitionRequest) => {
    events.push(`ensure:${request.projectKey}`);
    const held = acquisitionGate;
    acquisitionGate = undefined;
    if (held !== undefined) await held.promise;
    return { outcome: 'existing' as const, identity: `tree:${request.projectKey}` };
  });
  const acquisition = { ensure };
  const dependencies = { owner, acquisition } satisfies ProjectMaterializerDependencies;
  const materializer = createProjectMaterializer(dependencies);

  return {
    materializer,
    dependencies,
    owner,
    acquisition,
    events,
    records,
    stages,
    interruptStageAtWrite(ordinal: number) {
      writeCount = 0;
      failWriteAt = ordinal;
    },
    holdNextStageWrite() {
      const gate = deferred<void>();
      writeGate = gate;
      return gate;
    },
    holdNextDurability() {
      const gate = deferred<void>();
      durabilityGate = gate;
      return gate;
    },
    failNextDurability(error: unknown) {
      durabilityFailure = error;
    },
    failStageDiscard(error: unknown) {
      discardFailure = error;
    },
    holdNextAcquisition() {
      const gate = deferred<void>();
      acquisitionGate = gate;
      return gate;
    },
    projectKeyAt(index = 0): string {
      const call = promoteStage.mock.calls[index];
      const input = call?.[0];
      if (input === undefined) throw new Error(`missing promotion call ${index}`);
      return input.projectKey;
    },
    project(projectKey: string): ProjectRecord {
      const record = records.get(projectKey);
      if (record === undefined) throw new Error(`missing project: ${projectKey}`);
      return record;
    },
    readText(projectKey: string, path: string): string {
      const bytes = this.project(projectKey).files.get(path);
      if (bytes === undefined) throw new Error(`missing file: ${projectKey}:${path}`);
      return new TextDecoder().decode(bytes);
    },
    readBytes(projectKey: string, path: string): Uint8Array {
      const bytes = this.project(projectKey).files.get(path);
      if (bytes === undefined) throw new Error(`missing file: ${projectKey}:${path}`);
      return bytes.slice();
    },
    mutate(projectKey: string, path: string, bytes: Uint8Array | string): void {
      const value = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
      this.project(projectKey).files.set(path, value.slice());
    },
  };
}

describe('project materialization', () => {
  it('stages the first seed, promotes it, crosses durability, then acquires packages', async () => {
    const h = materializationHarness();
    const binary = new Uint8Array([0, 255, 1, 254]);
    const definition = viteDefinition('first-seed', {
      '/src/main.ts': "document.body.textContent = 'first'",
      '/public/data.bin': binary,
    });

    await h.materializer.open(definition);

    const projectKey = h.projectKeyAt();
    expect(projectKey).not.toContain('/');
    expect(h.readText(projectKey, '/src/main.ts')).toBe("document.body.textContent = 'first'");
    expect(h.readBytes(projectKey, '/public/data.bin')).toEqual(binary);
    expect(h.stages.size).toBe(0);

    const promoteIndex = h.events.indexOf(`promote:${projectKey}`);
    const durabilityIndex = h.events.findIndex((event) => event.startsWith('durability:'));
    const acquisitionIndex = h.events.indexOf(`ensure:${projectKey}`);
    expect(promoteIndex).toBeGreaterThan(
      h.events.findIndex((event) => event.startsWith(`write:${projectKey}:`)),
    );
    expect(durabilityIndex).toBeGreaterThan(promoteIndex);
    expect(acquisitionIndex).toBeGreaterThan(durabilityIndex);
    expect(h.acquisition.ensure).toHaveBeenCalledWith({
      projectKey,
      projectRoot: h.project(projectKey).projectRoot,
      definition,
    });
  });

  it('reopens the same identity without overlaying user mutations', async () => {
    const h = materializationHarness();
    const definition = viteDefinition('same-identity');
    await h.materializer.open(definition);
    const projectKey = h.projectKeyAt();
    h.mutate(projectKey, '/src/main.ts', "document.body.textContent = 'user edit'");

    h.owner.discardStage.mockClear();
    h.owner.beginStage.mockClear();
    h.owner.writeStageFile.mockClear();
    h.owner.promoteStage.mockClear();
    h.owner.waitForDurability.mockClear();
    h.acquisition.ensure.mockClear();
    await h.materializer.open(definition);

    expect(h.readText(projectKey, '/src/main.ts')).toBe("document.body.textContent = 'user edit'");
    expect(h.owner.discardStage).not.toHaveBeenCalled();
    expect(h.owner.beginStage).not.toHaveBeenCalled();
    expect(h.owner.writeStageFile).not.toHaveBeenCalled();
    expect(h.owner.promoteStage).not.toHaveBeenCalled();
    expect(h.acquisition.ensure).toHaveBeenCalledTimes(1);
  });

  it('rejects a changed definition identity before any mutation or acquisition', async () => {
    const h = materializationHarness();
    const first = viteDefinition('identity-mismatch', { '/seed.txt': 'one' });
    const changed = viteDefinition('identity-mismatch', { '/seed.txt': 'two' });
    await h.materializer.open(first);
    const projectKey = h.projectKeyAt();
    const mutationCounts = {
      discard: h.owner.discardStage.mock.calls.length,
      begin: h.owner.beginStage.mock.calls.length,
      write: h.owner.writeStageFile.mock.calls.length,
      promote: h.owner.promoteStage.mock.calls.length,
      remove: h.owner.deleteProject.mock.calls.length,
      acquire: h.acquisition.ensure.mock.calls.length,
    };

    await expect(h.materializer.open(changed)).rejects.toBeInstanceOf(
      ProjectDefinitionMismatchError,
    );

    expect(h.readText(projectKey, '/seed.txt')).toBe('one');
    expect(h.owner.discardStage).toHaveBeenCalledTimes(mutationCounts.discard);
    expect(h.owner.beginStage).toHaveBeenCalledTimes(mutationCounts.begin);
    expect(h.owner.writeStageFile).toHaveBeenCalledTimes(mutationCounts.write);
    expect(h.owner.promoteStage).toHaveBeenCalledTimes(mutationCounts.promote);
    expect(h.owner.deleteProject).toHaveBeenCalledTimes(mutationCounts.remove);
    expect(h.acquisition.ensure).toHaveBeenCalledTimes(mutationCounts.acquire);
  });

  it('never exposes a partial target and recovers an interrupted stage on retry', async () => {
    const h = materializationHarness();
    const definition = viteDefinition('interrupted-stage', {
      '/one.txt': 'one',
      '/two.txt': 'two',
    });
    h.interruptStageAtWrite(1);

    await expect(h.materializer.open(definition)).rejects.toThrow('injected stage interruption');
    expect(h.records.size).toBe(0);
    expect(h.acquisition.ensure).not.toHaveBeenCalled();

    await h.materializer.open(definition);
    const projectKey = h.projectKeyAt();
    expect(h.readText(projectKey, '/one.txt')).toBe('one');
    expect(h.readText(projectKey, '/two.txt')).toBe('two');
    expect(h.stages.size).toBe(0);
    expect(h.owner.discardStage).toHaveBeenCalledWith(projectKey);
  });

  it('does not resolve delete until its exact revision is durable', async () => {
    const h = materializationHarness();
    const definition = viteDefinition('durable-delete');
    await h.materializer.open(definition);
    const projectKey = h.projectKeyAt();
    const gate = h.holdNextDurability();

    const deleting = h.materializer.delete('durable-delete');
    await waitUntil(() => h.owner.deleteProject.mock.calls.length === 1);
    expect(h.records.has(projectKey)).toBe(false);
    expect(
      await settledOr(
        deleting.then(() => 'deleted'),
        'pending',
      ),
    ).toBe('pending');

    const deleteResult = h.owner.deleteProject.mock.results[0];
    expect(deleteResult?.type).toBe('return');
    gate.resolve();
    await expect(deleting).resolves.toBeUndefined();
    const deleteDurability = h.owner.waitForDurability.mock.calls.at(-1)?.[0];
    expect(deleteDurability).toEqual({ projectKey, revision: expect.any(Number) });
  });

  it('rejects delete loudly when the durability barrier fails', async () => {
    const h = materializationHarness();
    await h.materializer.open(viteDefinition('failed-delete-proof'));
    const projectKey = h.projectKeyAt();
    h.failNextDurability(new Error('delete persistence failed'));

    await expect(h.materializer.delete('failed-delete-proof')).rejects.toThrow(
      'delete persistence failed',
    );
    expect(h.records.has(projectKey)).toBe(false);
  });

  it('keeps roots and acquisition stamp scopes distinct for injectively encoded ids', async () => {
    const h = materializationHarness();
    const first = viteDefinition('project-\ud800');
    const second = viteDefinition('project-\ud801');

    await h.materializer.open(first);
    await h.materializer.open(second);

    const firstKey = h.projectKeyAt(0);
    const secondKey = h.projectKeyAt(1);
    expect(firstKey).not.toBe(secondKey);
    expect(firstKey).not.toContain('/');
    expect(secondKey).not.toContain('/');
    const [firstRequest, secondRequest] = h.acquisition.ensure.mock.calls.map((call) => call[0]);
    expect(firstRequest?.projectKey).toBe(firstKey);
    expect(secondRequest?.projectKey).toBe(secondKey);
    expect(firstRequest?.projectRoot).not.toBe(secondRequest?.projectRoot);
    expect(`${firstRequest?.projectRoot}/.rifty/install-stamp`).not.toBe(
      `${secondRequest?.projectRoot}/.rifty/install-stamp`,
    );
    expect(h.records.size).toBe(2);
  });

  it('serializes concurrent opens of one id and exposes exact materialization provenance', async () => {
    const h = materializationHarness();
    const definition = viteDefinition('concurrent-same-id');

    const first = h.materializer.open(definition);
    const second = h.materializer.open(definition);
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(h.owner.beginStage).toHaveBeenCalledTimes(1);
    expect(h.owner.promoteStage).toHaveBeenCalledTimes(1);
    expect(h.acquisition.ensure).toHaveBeenCalledTimes(2);
    expect(firstResult.projectKey).toBe(secondResult.projectKey);
    expect(firstResult.projectRoot).toBe(secondResult.projectRoot);
    expect(firstResult.projectRoot).toBe(h.project(firstResult.projectKey).projectRoot);
    expect(firstResult.acquisition).toEqual({
      outcome: 'existing',
      identity: `tree:${firstResult.projectKey}`,
    });
  });

  it('serializes concurrent conflicting identities and preserves the admitted seed', async () => {
    const h = materializationHarness();
    const firstDefinition = viteDefinition('concurrent-mismatch', { '/seed.txt': 'one' });
    const secondDefinition = viteDefinition('concurrent-mismatch', { '/seed.txt': 'two' });

    const first = h.materializer.open(firstDefinition);
    const second = h.materializer.open(secondDefinition);

    const materialized = await first;
    await expect(second).rejects.toBeInstanceOf(ProjectDefinitionMismatchError);
    expect(h.readText(materialized.projectKey, '/seed.txt')).toBe('one');
    expect(h.owner.beginStage).toHaveBeenCalledTimes(1);
    expect(h.acquisition.ensure).toHaveBeenCalledTimes(1);
  });

  it('re-proves a promoted revision after durability failure without reseeding', async () => {
    const h = materializationHarness();
    const definition = viteDefinition('retry-durability');
    h.failNextDurability(new Error('seed durability failed'));

    await expect(h.materializer.open(definition)).rejects.toThrow('seed durability failed');
    expect(h.records.size).toBe(1);
    expect(h.acquisition.ensure).not.toHaveBeenCalled();

    const result = await h.materializer.open(definition);
    expect(h.owner.beginStage).toHaveBeenCalledTimes(1);
    expect(h.owner.promoteStage).toHaveBeenCalledTimes(1);
    expect(h.owner.waitForDurability).toHaveBeenCalledTimes(2);
    expect(h.acquisition.ensure).toHaveBeenCalledTimes(1);
    expect(result.projectRoot).toBe(h.project(result.projectKey).projectRoot);
  });
});

describe('project materializer close faults', () => {
  it('rejects close when an interrupted seed stage cannot be discarded', async () => {
    const h = materializationHarness();
    const gate = h.holdNextStageWrite();
    const definition = viteDefinition('failed-close-stage-cleanup', {
      '/one.txt': 'one',
      '/two.txt': 'two',
    });
    const opening = h.materializer.open(definition);
    await waitUntil(() => h.owner.writeStageFile.mock.calls.length === 1);
    const cleanupFailure = new Error('stage discard failed');
    h.failStageDiscard(cleanupFailure);

    const closing = h.materializer.close();
    gate.resolve();

    const openError = await opening.catch((error: unknown) => error);
    expect(openError).toBeInstanceOf(ClosedHandleError);
    expect((openError as ClosedHandleError).cause).toBeInstanceOf(AggregateError);
    expect(((openError as ClosedHandleError).cause as AggregateError).errors).toContain(
      cleanupFailure,
    );
    await expect(closing).rejects.toBe(cleanupFailure);
    expect(h.stages.size).toBe(1);
    expect(h.records.size).toBe(0);
  });

  it('close during seed waits for the admitted write, rejects open, and leaves no target', async () => {
    const h = materializationHarness();
    const gate = h.holdNextStageWrite();
    const definition = viteDefinition('close-during-seed', {
      '/one.txt': 'one',
      '/two.txt': 'two',
    });
    const opening = h.materializer.open(definition);
    await waitUntil(() => h.owner.writeStageFile.mock.calls.length === 1);

    const closing = h.materializer.close();
    expect(
      await settledOr(
        closing.then(() => 'closed'),
        'pending',
      ),
    ).toBe('pending');
    gate.resolve();

    await expect(opening).rejects.toBeInstanceOf(ClosedHandleError);
    await expect(closing).resolves.toBeUndefined();
    expect(h.records.size).toBe(0);
    expect(h.stages.size).toBe(0);
    expect(h.acquisition.ensure).not.toHaveBeenCalled();
    await expect(h.materializer.open(definition)).rejects.toBeInstanceOf(ClosedHandleError);
  });

  it('close during install waits for acquisition, rejects open, and keeps the valid seed', async () => {
    const h = materializationHarness();
    const gate = h.holdNextAcquisition();
    const definition = viteDefinition('close-during-install');
    const opening = h.materializer.open(definition);
    await waitUntil(() => h.acquisition.ensure.mock.calls.length === 1);
    const projectKey = h.projectKeyAt();
    expect(h.records.has(projectKey)).toBe(true);

    const closing = h.materializer.close();
    expect(
      await settledOr(
        closing.then(() => 'closed'),
        'pending',
      ),
    ).toBe('pending');
    gate.resolve();

    await expect(opening).rejects.toBeInstanceOf(ClosedHandleError);
    await expect(closing).resolves.toBeUndefined();
    expect(h.records.has(projectKey)).toBe(true);
    expect(h.stages.size).toBe(0);

    const reopened = createProjectMaterializer(h.dependencies);
    await reopened.open(definition);
    expect(h.owner.beginStage).toHaveBeenCalledTimes(1);
    await reopened.close();
  });

  it('close during seed durability keeps the promoted seed but fences acquisition', async () => {
    const h = materializationHarness();
    const gate = h.holdNextDurability();
    const definition = viteDefinition('close-during-seed-durability');
    const opening = h.materializer.open(definition);
    await waitUntil(() => h.owner.promoteStage.mock.calls.length === 1);
    const projectKey = h.projectKeyAt();

    const closing = h.materializer.close();
    expect(
      await settledOr(
        closing.then(() => 'closed'),
        'pending',
      ),
    ).toBe('pending');
    gate.resolve();

    await expect(opening).rejects.toBeInstanceOf(ClosedHandleError);
    await expect(closing).resolves.toBeUndefined();
    expect(h.records.has(projectKey)).toBe(true);
    expect(h.acquisition.ensure).not.toHaveBeenCalled();

    const reopened = createProjectMaterializer(h.dependencies);
    await reopened.open(definition);
    expect(h.owner.beginStage).toHaveBeenCalledTimes(1);
    await reopened.close();
  });

  it('close during delete durability waits and preserves the exact successful delete result', async () => {
    const h = materializationHarness();
    await h.materializer.open(viteDefinition('close-during-delete'));
    const projectKey = h.projectKeyAt();
    const gate = h.holdNextDurability();
    const deleting = h.materializer.delete('close-during-delete');
    await waitUntil(() => h.owner.deleteProject.mock.calls.length === 1);

    const closing = h.materializer.close();
    expect(
      await settledOr(
        closing.then(() => 'closed'),
        'pending',
      ),
    ).toBe('pending');
    gate.resolve();

    await expect(deleting).resolves.toBeUndefined();
    await expect(closing).resolves.toBeUndefined();
    expect(h.records.has(projectKey)).toBe(false);
  });
});
