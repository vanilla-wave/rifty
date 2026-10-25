import { expect, it } from 'vitest';
import {
  type AgentSessionEvent,
  createAgentSession,
  createModels,
  createOpenAIProvider,
} from '../../../packages/agent/src/index.ts';
import { MemoryVfs } from '../../../packages/vfs/src/index.ts';
import { scriptedProvider } from '../../../tests/integration/fixtures/workbench-vite-consumer/src/agent-scripted-provider.ts';
import { catalogEndpoint } from '../tests/catalog-endpoint.ts';
import { coreObservation } from './lanes/core-observation.ts';

const cases: {
  secret: string;
  replies: Parameters<typeof scriptedProvider>[0];
  maxToolCalls?: number;
  expected: Record<string, number | boolean>;
}[] = [
  {
    secret: 'edit_file',
    replies: [
      [{ name: 'edit_file', args: { path: 'one.txt', old: 'absent', new: 'world' } }],
      'Done.',
    ],
    expected: { editFailures: 1 },
  },
  {
    secret: 'Validation failed for tool ',
    replies: [[{ name: 'read_file', args: {} }], 'Done.'],
    expected: { malformedToolCalls: 1 },
  },
  {
    secret: 'maximum context length',
    replies: [{ error: 'maximum context length is 32768 tokens' }],
    expected: { contextExceeded: true },
  },
  {
    secret: 'Operation aborted',
    replies: [
      [
        { name: 'read_file', args: { path: 'one.txt' } },
        { name: 'read_file', args: { path: 'one.txt' } },
      ],
      'Done.',
    ],
    maxToolCalls: 1,
    expected: { toolCalls: 1 },
  },
];

it.each(cases)(
  'measures raw events before masking header $secret',
  async ({ secret, replies, maxToolCalls, expected }) => {
    const wire = scriptedProvider(replies);
    const endpoint = catalogEndpoint('https://bench.invalid/v1', {
      headers: { 'X-Probe': secret },
    });
    const models = createModels();
    models.setProvider(
      createOpenAIProvider({ id: endpoint.provider, models: [endpoint], fetch: wire.fetch }),
    );
    const vfs = new MemoryVfs();
    await vfs.writeFile('/one.txt', 'hello');
    const session = createAgentSession({
      models,
      model: endpoint.id,
      maxToolCalls,
      host: {
        root: '/',
        async close() {},
        capabilities: () => ({
          files: {
            read: (path) => vfs.readFileText(path),
            list: async (path) =>
              (await vfs.readdir(path)).map((entry) => ({
                path: `${path.replace(/\/$/, '')}/${entry.name}`,
                kind: entry.isDirectory ? 'dir' : 'file',
              })),
            async change(path, transform) {
              const next = transform(
                (await vfs.exists(path)) ? await vfs.readFileText(path) : null,
              );
              if (next === null) await vfs.rm(path);
              else await vfs.writeFile(path, next);
            },
          },
        }),
      },
    });
    const events: AgentSessionEvent[] = [];
    session.subscribe((event) => events.push(structuredClone(event)));
    try {
      await session.send('Inspect the file.');
      const trace = await session.exportTrace();
      expect(await vfs.readFileText('/one.txt')).toBe('hello');
      expect(coreObservation(trace, wire.requests, events)).toMatchObject(expected);
    } finally {
      await session.dispose();
    }
  },
);
