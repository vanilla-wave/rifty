import type { PersistFailureReport } from '@riftydev/vfs';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createOwnerVfsAuthority } from './owner-vfs-authority.ts';
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
    await h.store.waitForDurability(promoted.revision);

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
    await h.store.waitForDurability(deleted.revision);
    expect(await h.store.readProject('alpha')).toBeNull();
    expect(h.authority.existsSync(promoted.projectRoot)).toBe(false);
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

    await expect(h.store.waitForDurability(h.authority.treeRevision)).rejects.toThrow(
      /1 unhealed persistence failure.*quota exceeded/i,
    );
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
