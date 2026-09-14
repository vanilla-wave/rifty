import {
  createAgentSession,
  createBrowserAgentPreview,
  createWorkbenchAgentHost,
} from '@riftydev/agent';
import type { ProjectSession } from '@riftydev/workbench';
import type { PlaygroundSessionTools } from '@riftydev/workbench/playground';
import { scriptedProvider } from './agent-scripted-provider';

export async function provePackedAgent(
  project: ProjectSession<unknown>,
  companion: PlaygroundSessionTools,
  previewUrl: string,
  message: string,
) {
  const source = `export const message = ${JSON.stringify(message)};\n`;
  const frame = document.querySelector<HTMLIFrameElement>('#preview');
  if (!frame) throw new Error('Packed agent preview frame missing');
  const provider = scriptedProvider([
    [{ name: 'write_file', args: { path: 'src/message.ts', content: 'export const message = ;' } }],
    [{ name: 'shell', args: { command: 'npm run build' } }],
    [{ name: 'write_file', args: { path: 'src/message.ts', content: source } }],
    [{ name: 'shell', args: { command: 'npm run build' } }],
    [{ name: 'preview_fetch', args: { path: 'src/message.ts' } }],
    'Repaired build.',
  ]);
  const agent = createAgentSession({
    host: createWorkbenchAgentHost({
      session: project,
      companion,
      preview: () => createBrowserAgentPreview({ url: () => previewUrl, frame: () => frame }),
    }),
    settings: {
      baseUrl: new URL('/mock-model/v1', location.href).href,
      model: 'scripted',
    },
    runTimeoutMs: 120_000,
    fetch: provider.fetch,
  });
  try {
    await agent.send('Repair the build using the installed dependencies.');
    const trace = await agent.exportTrace();
    if (agent.status() !== 'done') throw new Error(`Packed agent failed: ${agent.detail()}`);
    const calls = trace.transcript.filter(
      (entry) => entry.role === 'toolResult' && entry.toolName === 'shell',
    );
    if (
      calls.length !== 2 ||
      calls[0]?.role !== 'toolResult' ||
      !calls[0].isError ||
      calls[1]?.role !== 'toolResult' ||
      calls[1].isError
    )
      throw new Error('Packed agent did not fail, repair and rebuild');
    if (provider.requests.some((request) => request.authorization !== null))
      throw new Error('No-key packed agent sent Authorization');
    return trace;
  } finally {
    await agent.dispose();
  }
}

export async function agentWriteMessage(project: ProjectSession<unknown>, message: string) {
  const provider = scriptedProvider([
    [
      {
        name: 'write_file',
        args: {
          path: 'src/message.ts',
          content: `export const message = ${JSON.stringify(message)};\n`,
        },
      },
    ],
    'Updated.',
  ]);
  const agent = createAgentSession({
    host: createWorkbenchAgentHost({ session: project }),
    settings: { baseUrl: new URL('/mock-model/v1', location.href).href, model: 'scripted' },
    fetch: provider.fetch,
  });
  try {
    await agent.send('Update the preview text.');
    if (agent.status() !== 'done') throw new Error(`Packed agent update failed: ${agent.detail()}`);
  } finally {
    await agent.dispose();
  }
}
