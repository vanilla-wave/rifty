import {
  type AgentMessage,
  createAgentSession,
  createWorkbenchAgentHost,
} from '../../../packages/agent/src/index.ts';
import { scriptedProvider } from './agent-scripted-provider.ts';
import { currentProject } from './sealed-playground-workbench.ts';

export async function proveHistory() {
  const saved: AgentMessage[] = [];
  const original = scriptedProvider([
    [{ name: 'write_file', args: { path: 'remember.txt', content: 'persisted work' } }],
    'Remember this work.',
  ]);
  const first = createAgentSession({
    host: createWorkbenchAgentHost({ session: currentProject() }),
    settings: { baseUrl: 'https://scripted.invalid/v1', model: 'old-model' },
    fetch: original.fetch,
  });
  first.subscribe((event) => {
    if (event.type === 'agent' && event.event.type === 'message_end')
      saved.push(event.event.message);
  });
  await first.send('Write remember.txt');
  await first.dispose();
  const seed = JSON.parse(JSON.stringify(saved)) as AgentMessage[];
  const provider = scriptedProvider([
    [{ name: 'read_file', args: { path: 'remember.txt' } }],
    'Continued.',
    'Fresh.',
  ]);
  const options = {
    host: createWorkbenchAgentHost({ session: currentProject() }),
    settings: { baseUrl: 'https://scripted.invalid/v1', model: 'new-model' },
    fetch: provider.fetch,
    initialMessages: seed,
    maxToolCalls: 1,
  };
  const second = createAgentSession(options);
  try {
    const restored = await second.exportTrace();
    await second.send('Continue from remembered work');
    const status = second.status();
    const continued = await second.exportTrace();
    second.reset();
    await second.send('Fresh start');
    return {
      seed,
      restored,
      continued,
      status,
      requests: provider.requests,
      reset: await second.exportTrace(),
      file: new TextDecoder().decode(
        (await currentProject().files.readFile('/remember.txt')).bytes,
      ),
    };
  } finally {
    await second.dispose();
  }
}
