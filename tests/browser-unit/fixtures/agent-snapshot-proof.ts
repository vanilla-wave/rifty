import {
  createAgentSession,
  createBrowserAgentPreview,
  createWorkbenchAgentHost,
} from '../../../packages/agent/src/index.ts';
import { scriptedProvider } from './agent-scripted-provider.ts';
import { currentProject, currentSessionTools } from './sealed-playground-workbench.ts';

export async function proveSnapshotBuild() {
  const project = currentProject();
  const run = project.run();
  const ready = (await run.ready) as { readonly url: string };
  const frame = document.createElement('iframe');
  const loaded = new Promise<void>((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true });
  });
  frame.id = 'agent-preview';
  frame.src = ready.url;
  document.body.append(frame);
  await loaded;
  const originalDocument = frame.contentDocument;
  if (!originalDocument?.querySelector('#app')?.textContent?.includes('Hello from real Vite'))
    throw new Error('Original Vite preview did not render');
  const pkg = await project.files.readFile('/package.json');
  const manifest = JSON.parse(new TextDecoder().decode(pkg.bytes));
  manifest.scripts = { ...manifest.scripts, build: 'vite build' };
  await project.files.writeFile(
    '/package.json',
    new TextEncoder().encode(JSON.stringify(manifest)),
    { expectedVersion: pkg.version },
  );
  const original = new TextDecoder().decode((await project.files.readFile('/src/main.js')).bytes);
  const fixed = original.replace(
    'Hello from real Vite running inside a kernel-spawned Worker — edit me, save.',
    'AGENT_SNAPSHOT_FIXED',
  );
  if (fixed === original) throw new Error('Snapshot oracle template changed');
  const provider = scriptedProvider([
    [{ name: 'write_file', args: { path: 'src/main.js', content: 'const broken = ;' } }],
    [{ name: 'shell', args: { command: 'npm run build' } }],
    [{ name: 'write_file', args: { path: 'src/main.js', content: fixed } }],
    [{ name: 'shell', args: { command: 'npm run build' } }],
    [{ name: 'preview_fetch', args: { path: 'src/main.js' } }],
    'Repaired the build.',
  ]);
  const session = createAgentSession({
    host: createWorkbenchAgentHost({
      session: project,
      companion: currentSessionTools(),
      preview: () => createBrowserAgentPreview({ url: () => ready.url, frame: () => frame }),
    }),
    settings: { baseUrl: 'https://scripted.invalid/v1', model: 'scripted' },
    runTimeoutMs: 120_000,
    fetch: provider.fetch,
  });
  try {
    await session.send('Fix the failed build and verify the preview.');
    return {
      status: session.status(),
      trace: await session.exportTrace(),
      built: new TextDecoder().decode((await project.files.readFile('/dist/index.html')).bytes),
      recoveryReloaded: frame.contentDocument !== originalDocument,
    };
  } finally {
    await session.dispose();
  }
}

export async function proveSnapshotHmr() {
  const project = currentProject();
  const current = new TextDecoder().decode((await project.files.readFile('/src/main.js')).bytes);
  const next = current.replace('AGENT_SNAPSHOT_FIXED', 'AGENT_VALID_HMR');
  if (next === current) throw new Error('Agent repair did not produce the expected baseline');
  const provider = scriptedProvider([
    [{ name: 'write_file', args: { path: 'src/main.js', content: next } }],
    'Updated.',
  ]);
  const agent = createAgentSession({
    host: createWorkbenchAgentHost({ session: project }),
    settings: { baseUrl: 'https://scripted.invalid/v1', model: 'scripted' },
    fetch: provider.fetch,
  });
  try {
    await agent.send('Update the live preview.');
    return agent.status();
  } finally {
    await agent.dispose();
  }
}
