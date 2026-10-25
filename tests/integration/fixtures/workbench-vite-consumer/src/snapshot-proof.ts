import {
  type PlaygroundWorkbenchOptions,
  openPlaygroundWorkbench,
} from '@riftydev/workbench/playground';

export interface SnapshotProof {
  readonly output: string;
  readonly version: string;
}

export async function runSnapshotProof(
  options: PlaygroundWorkbenchOptions,
  assetUrl: string,
): Promise<SnapshotProof> {
  const response = await fetch('/producer-snapshot.json');
  if (!response.ok) throw new Error(`Producer identities HTTP ${response.status}`);
  const snapshot = (await response.json()) as {
    readonly packageJsonText: string;
    readonly entrySource: string;
    readonly expectedOutput: string;
    readonly snapshotId: string;
    readonly templateId: string;
  };
  const workbench = await openPlaygroundWorkbench(options);
  try {
    const definition = workbench.playground.define({
      kind: 'node-cli',
      id: 'scratch',
      starterId: 'packed-ms',
      templateId: snapshot.templateId,
      entryPath: '/main.cjs',
      files: {
        '/package.json': snapshot.packageJsonText,
        '/main.cjs': snapshot.entrySource,
      },
      firstMaterialization: {
        kind: 'snapshot',
        snapshot: { snapshotId: snapshot.snapshotId, templateId: snapshot.templateId, assetUrl },
      },
    });
    await workbench.playground.catalog.createScratch({ definition });
    const project = await workbench.openProject(definition);
    let output = '';
    const run = project.run();
    const detach = run.terminal.attach((chunk) => {
      output += chunk;
    });
    try {
      await run.ready;
      const exit = await run.exited;
      if (exit.code !== 0 || !output.includes(snapshot.expectedOutput)) {
        throw new Error(`Packed producer guest failed: ${JSON.stringify(exit)} ${output}`);
      }
      const bytes = (await project.files.readFile('/node_modules/ms/package.json')).bytes;
      const installed = JSON.parse(new TextDecoder().decode(bytes)) as { readonly version: string };
      return { output, version: installed.version };
    } finally {
      detach();
      await run.close();
      await project.close();
    }
  } finally {
    await workbench.close();
  }
}
