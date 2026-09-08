import type { ProjectSession } from '@riftydev/workbench';
import {
  type PlaygroundWorkbench,
  type PlaygroundWorkbenchOptions,
  openPlaygroundWorkbench,
} from '@riftydev/workbench/playground';

interface Snapshot {
  readonly packageJsonText: string;
  readonly entrySource: string;
  readonly savedEntrySource: string;
  readonly savedExpectedOutput: string;
  readonly snapshotId: string;
  readonly templateId: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const indexPath = '/node_modules/ms/index.js';
const retainedText = 'retained public project bytes\n';

function expectBytes(actual: Uint8Array, expected: Uint8Array, label: string) {
  if (
    actual.length !== expected.length ||
    !actual.every((byte, index) => byte === expected[index])
  ) {
    throw new Error(`Packed snapshot application changed ${label}`);
  }
}

async function runSavedProgram(project: ProjectSession<void>, expected: string) {
  const run = project.run();
  let output = '';
  const detach = run.terminal.attach((chunk) => {
    output += chunk;
  });
  try {
    await run.ready;
    const exit = await run.exited;
    if (exit.code !== 0 || !output.includes(expected)) {
      throw new Error(`Saved project disagrees with Node: ${JSON.stringify(exit)} ${output}`);
    }
  } finally {
    detach();
    await run.close();
  }
}

export async function proveSnapshotApplication(
  options: PlaygroundWorkbenchOptions,
  assetUrl: string,
) {
  const response = await fetch('/producer-snapshot.json');
  if (!response.ok) throw new Error(`Producer identities HTTP ${response.status}`);
  const snapshot = (await response.json()) as Snapshot;
  const persistent = {
    ...options,
    storage: { ...options.storage, persistence: 'required' as const },
  };
  const definition = (
    workbench: PlaygroundWorkbench,
    id: string,
    source: { snapshotId: string; assetUrl: string },
    application?: { mode: 'apply-snapshot'; conflict?: 'error' | 'overwrite' },
  ) =>
    workbench.playground.define({
      kind: 'node-cli',
      id,
      starterId: 'packed-ms',
      templateId: snapshot.templateId,
      entryPath: '/main.cjs',
      files: { '/package.json': snapshot.packageJsonText, '/main.cjs': snapshot.entrySource },
      firstMaterialization: {
        kind: 'snapshot',
        snapshot: { ...source, templateId: snapshot.templateId },
        ...(application ? { application } : {}),
      },
    });
  const original = { snapshotId: snapshot.snapshotId, assetUrl };
  const unused = {
    snapshotId: `sha256:${'0'.repeat(64)}`,
    assetUrl: new URL('./unused-new-snapshot.tar', assetUrl).href,
  };
  const savedSource = encoder.encode(snapshot.savedEntrySource);
  let originalIndex = new Uint8Array();
  let editedIndex = new Uint8Array();
  const first = await openPlaygroundWorkbench(persistent);
  try {
    const scratch = definition(first, 'scratch', original);
    await first.playground.catalog.createScratch({ definition: scratch });
    const project = await first.openProject(scratch);
    try {
      const main = await project.files.readFile('/main.cjs');
      await project.files.writeFile('/main.cjs', savedSource, { expectedVersion: main.version });
      const index = await project.files.readFile(indexPath);
      originalIndex = index.bytes.slice();
      editedIndex = encoder.encode(
        `${decoder.decode(index.bytes)}\n// retained local dependency edit\n`,
      );
      await project.files.writeFile(indexPath, editedIndex, { expectedVersion: index.version });
      await project.files.writeFile('/user.txt', encoder.encode(retainedText), {
        expectedVersion: null,
      });
      await project.files.writeFile('/node_modules/ms/local.txt', encoder.encode(retainedText), {
        expectedVersion: null,
      });
      await first.playground.forSession(project).awaitDurability();
    } finally {
      await project.close();
    }
    await first.playground.catalog.saveScratch({
      id: 'packed-saved',
      name: 'Packed saved project',
      definition: definition(first, 'packed-saved', original),
    });
  } finally {
    await first.close();
  }

  const workbench = await openPlaygroundWorkbench(persistent);
  const checkRetained = async (project: ProjectSession<void>, expectedIndex: Uint8Array) => {
    expectBytes((await project.files.readFile('/main.cjs')).bytes, savedSource, 'saved source');
    expectBytes((await project.files.readFile(indexPath)).bytes, expectedIndex, 'dependency bytes');
    for (const path of ['/user.txt', '/node_modules/ms/local.txt']) {
      expectBytes((await project.files.readFile(path)).bytes, encoder.encode(retainedText), path);
    }
  };
  try {
    const saved = await workbench.openProject(definition(workbench, 'packed-saved', unused));
    try {
      await checkRetained(saved, editedIndex);
      await runSavedProgram(saved, snapshot.savedExpectedOutput);
    } finally {
      await saved.close();
    }

    let failed: unknown;
    let unexpected: ProjectSession<void> | undefined;
    try {
      unexpected = await workbench.openProject(
        definition(workbench, 'packed-saved', original, { mode: 'apply-snapshot' }),
      );
    } catch (error) {
      failed = error;
    } finally {
      await unexpected?.close();
    }
    if (
      !(failed instanceof Error) ||
      failed.name !== 'SnapshotApplicationConflictError' ||
      JSON.stringify(Reflect.get(failed, 'conflictingPaths')) !== JSON.stringify([indexPath])
    ) {
      throw new Error(`Public snapshot conflict details were lost: ${String(failed)}`);
    }
    const retained = await workbench.openProject(definition(workbench, 'packed-saved', unused));
    try {
      await checkRetained(retained, editedIndex);
    } finally {
      await retained.close();
    }

    const apply = definition(workbench, 'packed-saved', original, {
      mode: 'apply-snapshot',
      conflict: 'overwrite',
    });
    for (let pass = 0; pass < 2; pass++) {
      const applied = await workbench.openProject(apply);
      try {
        await checkRetained(applied, originalIndex);
        await runSavedProgram(applied, snapshot.savedExpectedOutput);
        if (pass === 0) {
          const index = await applied.files.readFile(indexPath);
          await applied.files.writeFile(indexPath, editedIndex, { expectedVersion: index.version });
          await workbench.playground.forSession(applied).awaitDurability();
        }
      } finally {
        await applied.close();
      }
    }
  } finally {
    await workbench.close();
  }
}
