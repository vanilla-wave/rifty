import { createMemoryFs } from '@riftydev/vfs/internal';
import { expect, it } from 'vitest';
import { createOwnerVfsAuthority } from './owner-vfs-authority.ts';
import { createWorkbenchProjectStore } from './workbench-project-store.ts';

it('I3 opens a new v2 definition without adopting or deleting the legacy project', async () => {
  const { fsSync } = createMemoryFs();
  const authority = createOwnerVfsAuthority(fsSync, { ownerEpoch: 'layout-test' });
  const legacy = '/.rifty/workbench/v1/projects/alpha';
  const encoder = new TextEncoder();
  authority.mkdirSync(`${legacy}/tree`, { recursive: true });
  authority.writeFileSync(`${legacy}/tree/edited.txt`, encoder.encode('legacy edits'));
  authority.writeFileSync(
    `${legacy}/definition.json`,
    encoder.encode(
      JSON.stringify({
        version: 1,
        projectKey: 'alpha',
        definitionIdentity: 'legacy-definition',
      }),
    ),
  );
  const store = createWorkbenchProjectStore(authority, { createStageId: () => 'new-definition' });
  expect(await store.readProject('alpha')).toBeNull();
  const stage = await store.beginStage('alpha');
  await store.writeStageFile(stage.stageId, '/seed.txt', encoder.encode('definition'));
  const promoted = await store.promoteStage({
    stageId: stage.stageId,
    projectKey: 'alpha',
    definitionIdentity: 'new-definition',
  });
  await store.waitForDurability(promoted.revision);
  expect(promoted.projectRoot).toBe('/.rifty/workbench/v2/projects/alpha/tree');
  expect(authority.readFileBytesSync(`${promoted.projectRoot}/seed.txt`)).toEqual(
    encoder.encode('definition'),
  );
  expect(authority.existsSync(`${promoted.projectRoot}/edited.txt`)).toBe(false);
  expect(authority.readFileBytesSync(`${legacy}/tree/edited.txt`)).toEqual(
    encoder.encode('legacy edits'),
  );
});
