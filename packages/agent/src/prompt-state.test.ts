import { expect, it } from 'vitest';
import { modelCatalog } from '../../../tests/integration/fixtures/workbench-vite-consumer/src/agent-catalog.ts';
import { scriptedProvider } from '../../../tests/integration/fixtures/workbench-vite-consumer/src/agent-scripted-provider.ts';
import { createAgentSession } from './index.ts';

// ADR-0569 §3: a changed prompt enters history as a system update (CLI 1.6.0); wire sends the current one.
it('a capability change appends one prompt update before the next user message', async () => {
  let notes = ['First note.'];
  const provider = scriptedProvider(['One.', 'Two.', 'Three.']);
  const session = createAgentSession({
    host: { root: '/', capabilities: () => ({ notes }), async close() {} },
    ...modelCatalog(undefined, provider.fetch),
  });
  try {
    await session.send('first');
    await session.send('same prompt');
    notes = ['Second note.'];
    await session.send('changed');
    const transcript = (await session.exportTrace()).transcript;
    expect(transcript.map(({ role }) => role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
      'assistant',
      'system',
      'user',
      'assistant',
    ]);
    const updates = transcript.flatMap((message) => (message.role === 'system' ? [message] : []));
    expect(updates[1]?.sections?.prompt).toContain('Second note.');
    expect(updates[1]?.sections?.prompt).not.toContain('First note.');
    const wirePrompt = (index: number) =>
      JSON.stringify(
        provider.requests[index]?.body.messages.filter(
          (m) => m.role !== 'user' && m.role !== 'assistant',
        ),
      );
    expect(wirePrompt(2)).toContain('Second note.');
    expect(wirePrompt(2)).not.toContain('First note.');
    expect(wirePrompt(1)).toContain('First note.');
  } finally {
    await session.dispose();
  }
});

it('restored foreign prompt sections are removed from the wire prompt', async () => {
  const provider = scriptedProvider(['Done.']);
  const session = createAgentSession({
    host: { root: '/', capabilities: () => ({}), async close() {} },
    ...modelCatalog(undefined, provider.fetch),
    initialMessages: [
      {
        role: 'system',
        content: '',
        sections: { preamble: 'OLD_CLI_PREAMBLE', cwd: '<cwd>\nOLD_CLI_CWD\n</cwd>' },
        timestamp: 0,
      },
      { role: 'user', content: 'old', timestamp: 1 },
    ],
  });
  try {
    await session.send('new');
    const wire = JSON.stringify(provider.requests[0]?.body.messages);
    expect(wire).toContain('Rifty runs Node-compatible programs');
    expect(wire).not.toContain('OLD_CLI_PREAMBLE');
    expect(wire).not.toContain('OLD_CLI_CWD');
  } finally {
    await session.dispose();
  }
});
