import type { PersistFailureReport } from '@riftydev/vfs';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createOwnerVfsAuthority } from './owner-vfs-authority.ts';
import { createWorkbenchRuntimeAssetStorage } from './workbench-owner-storage.ts';
import { createWorkbenchProjectStore } from './workbench-project-store.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function harness() {
  const { fsSync } = createMemoryFs();
  const authority = createOwnerVfsAuthority(fsSync, { ownerEpoch: 'project-store-test-owner' });
  const store = createWorkbenchProjectStore(authority, {
    createStageId: () => 'stage-1',
  });
  return { authority, store };
}

describe('Workbench project store', () => {
  it('promotes a complete stage into one stable owner-authoritative project root', async () => {
    const h = harness();

    expect(await h.store.readProject('alpha')).toBeNull();
    await h.store.discardStage('alpha');
    const stage = await h.store.beginStage('alpha');
    await h.store.writeStageFile(stage.stageId, '/index.html', encoder.encode('<h1>A</h1>'));
    await h.store.writeStageFile(
      stage.stageId,
      '/src/main.js',
      encoder.encode("document.body.dataset.ready = 'yes';"),
    );
    const promoted = await h.store.promoteStage({
      stageId: stage.stageId,
      projectKey: 'alpha',
      definitionIdentity: 'definition-a',
    });
    await h.store.waitForDurability({ projectKey: 'alpha', revision: promoted.revision });

    expect(promoted.projectRoot).toBe('/.rifty/workbench/v1/projects/alpha/tree');
    expect(
      decoder.decode(h.authority.readFileBytesSync(`${promoted.projectRoot}/index.html`)),
    ).toBe('<h1>A</h1>');
    expect(
      decoder.decode(h.authority.readFileBytesSync(`${promoted.projectRoot}/src/main.js`)),
    ).toBe("document.body.dataset.ready = 'yes';");
    expect(await h.store.readProject('alpha')).toEqual({
      definitionIdentity: 'definition-a',
      projectRoot: promoted.projectRoot,
      revision: h.authority.treeRevision,
    });
  });

  it('preserves guest mutations on same-key reopen and delete starts clean', async () => {
    const h = harness();
    const stage = await h.store.beginStage('alpha');
    await h.store.writeStageFile(stage.stageId, '/index.html', encoder.encode('seed'));
    const promoted = await h.store.promoteStage({
      stageId: stage.stageId,
      projectKey: 'alpha',
      definitionIdentity: 'definition-a',
    });
    h.authority.writeFileSync(`${promoted.projectRoot}/retained.txt`, encoder.encode('guest'));

    const reopened = await h.store.readProject('alpha');
    expect(reopened?.projectRoot).toBe(promoted.projectRoot);
    expect(
      decoder.decode(h.authority.readFileBytesSync(`${promoted.projectRoot}/retained.txt`)),
    ).toBe('guest');

    const deleted = await h.store.deleteProject('alpha');
    await h.store.waitForDurability({ projectKey: 'alpha', revision: deleted.revision });
    expect(await h.store.readProject('alpha')).toBeNull();
    expect(h.authority.existsSync(promoted.projectRoot)).toBe(false);
  });

  it('deletes only the captured project and retains owner runtime assets', async () => {
    const h = harness();
    const assets = createWorkbenchRuntimeAssetStorage(h.authority, 'memory-session');
    const assetEntry = { kind: 'temp' as const, id: 'retained-across-project-delete' };
    await assets.write(assetEntry, new Uint8Array([4, 2]));
    const stage = await h.store.beginStage('alpha');
    await h.store.writeStageFile(stage.stageId, '/index.js', encoder.encode('project'));
    await h.store.promoteStage({
      stageId: stage.stageId,
      projectKey: 'alpha',
      definitionIdentity: 'definition-a',
    });

    const deleted = await h.store.deleteProject('alpha');
    await h.store.waitForDurability({ projectKey: 'alpha', revision: deleted.revision });

    await expect(assets.read(assetEntry)).resolves.toEqual(new Uint8Array([4, 2]));
    await assets.close();
  });

  it('rejects corrupt partial project metadata instead of silently reseeding over it', async () => {
    const h = harness();
    h.authority.mkdirSync('/.rifty/workbench/v1/projects/corrupt/tree', { recursive: true });
    h.authority.writeFileSync(
      '/.rifty/workbench/v1/projects/corrupt/tree/user.txt',
      encoder.encode('must-survive-diagnosis'),
    );

    await expect(h.store.readProject('corrupt')).rejects.toThrow(/metadata.*missing/i);
    expect(
      decoder.decode(
        h.authority.readFileBytesSync('/.rifty/workbench/v1/projects/corrupt/tree/user.txt'),
      ),
    ).toBe('must-survive-diagnosis');
  });

  it('rejects a durability barrier when the owner reports unhealed persistence failures', async () => {
    const h = harness();
    const report: PersistFailureReport = {
      failures: [
        {
          path: '/.rifty/workbench/v1/projects/alpha/tree/index.html',
          op: 'write',
          message: 'quota exceeded',
        },
      ],
      total: 1,
    };
    h.authority.flush = async () => report;

    await expect(
      h.store.waitForDurability({
        projectKey: 'alpha',
        revision: h.authority.treeRevision,
      }),
    ).rejects.toThrow(/project persistence.*unhealed failure.*quota exceeded/i);
  });

  it('does not let an asset-only persistence failure cross-poison project durability', async () => {
    const h = harness();
    const report: PersistFailureReport = {
      failures: [
        {
          path: '/.rifty/workbench/v1/runtime-assets/v1/objects/deadbeef',
          op: 'write',
          message: 'asset quota exceeded',
        },
      ],
      total: 1,
      anyFailure: (predicate) =>
        predicate('/.rifty/workbench/v1/runtime-assets/v1/objects/deadbeef'),
    };
    h.authority.flush = async () => report;

    await expect(
      h.store.waitForDurability({
        projectKey: 'alpha',
        revision: h.authority.treeRevision,
      }),
    ).resolves.toBeUndefined();
  });

  it('keeps mixed sibling-ledger details out of project durability failures', async () => {
    const h = harness();
    const assetPath = '/.rifty/workbench/v1/runtime-assets/v1/objects/private-asset';
    h.authority.flush = async () => ({
      failures: [
        { path: assetPath, op: 'write', message: 'private asset quota detail' },
        {
          path: '/.rifty/workbench/v1/projects/alpha/tree/index.html',
          op: 'write',
          message: 'project quota detail',
        },
      ],
      total: 2,
    });

    const failure = await h.store
      .waitForDurability({ projectKey: 'alpha', revision: h.authority.treeRevision })
      .then(
        () => null,
        (error: unknown) => error,
      );
    const detail = String(failure);
    expect(detail).toContain('project quota detail');
    expect(detail).not.toContain(assetPath);
    expect(detail).not.toContain('private asset quota detail');
    expect(detail).not.toContain('2 unhealed');
  });

  it('uses full-ledger evidence and loudly rejects an ambiguous bounded sample', async () => {
    const h = harness();
    const hiddenProjectPath = '/.rifty/workbench/v1/projects/alpha/tree/hidden.js';
    const assetSample = {
      path: '/.rifty/workbench/v1/runtime-assets/v1/tmp/residue',
      op: 'write' as const,
      message: 'asset residue',
    };
    h.authority.flush = async () => ({
      failures: [assetSample],
      total: 2,
      anyFailure: (predicate) => predicate(assetSample.path) || predicate(hiddenProjectPath),
    });
    await expect(
      h.store.waitForDurability({
        projectKey: 'alpha',
        revision: h.authority.treeRevision,
      }),
    ).rejects.toThrow(/persistence.*unhealed failure/i);

    h.authority.flush = async () => ({ failures: [assetSample], total: 2 });
    await expect(
      h.store.waitForDurability({
        projectKey: 'alpha',
        revision: h.authority.treeRevision,
      }),
    ).rejects.toThrow(/truncated.*full-ledger/i);
  });

  it('binds stage ids to their project key and rejects traversal-shaped inputs', async () => {
    const h = harness();
    const stage = await h.store.beginStage('alpha');

    await expect(
      h.store.promoteStage({
        stageId: stage.stageId,
        projectKey: 'beta',
        definitionIdentity: 'definition-a',
      }),
    ).rejects.toThrow(/stage.*project/i);
    await expect(
      h.store.writeStageFile(stage.stageId, '/../escape', encoder.encode('x')),
    ).rejects.toThrow(/project-rooted path/i);
    await expect(h.store.beginStage('../escape')).rejects.toThrow(/project key/i);
  });
});
