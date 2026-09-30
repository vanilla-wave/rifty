import { describe, expect, it } from 'vitest';
import {
  type ScriptedReply,
  scriptedProvider,
} from '../../../tests/integration/fixtures/workbench-vite-consumer/src/agent-scripted-provider.ts';
import { MemoryVfs } from '../../vfs/src/index.ts';
import * as api from './index.ts';
import type { AgentMessage, AgentSessionEvent, AgentSessionOptions, AgentStatus } from './index.ts';

type Item =
  | {
      kind: 'message';
      id: number;
      role: 'user' | 'assistant';
      text: string;
      streamingText?: string;
      message?: AgentMessage;
    }
  | {
      kind: 'tool';
      id: number;
      callId: string;
      name: string;
      state: 'pending' | 'running' | 'success' | 'error' | 'cancelled';
      result?: { content: unknown };
      output: readonly { chunk: string; stream: string }[];
    }
  | { kind: 'notice'; id: number; event: AgentSessionEvent }
  | { kind: 'output'; id: number; command: string; chunk: string; stream: string };
interface State {
  readonly items: readonly Item[];
  readonly status: AgentStatus;
  readonly detail?: string;
}
function projection() {
  const create: unknown = Reflect.get(api, 'createAgentTranscript');
  const reduce: unknown = Reflect.get(api, 'reduceAgentTranscript');
  expect(create, 'public transcript initializer').toBeTypeOf('function');
  expect(reduce, 'public transcript reducer').toBeTypeOf('function');
  return {
    create: create as () => State,
    reduce: reduce as (state: State, event: AgentSessionEvent) => State,
  };
}

async function fixture(
  replies: readonly ScriptedReply[],
  options: Partial<AgentSessionOptions> = {},
) {
  const vfs = new MemoryVfs();
  await vfs.writeFile('/same.txt', 'unchanged');
  const wire = scriptedProvider(replies);
  const models = api.createModels();
  models.setProvider(
    api.createOpenAIProvider({
      id: 'local',
      fetch: wire.fetch,
      models: ['small', 'other'].map((id) => ({
        id,
        name: id,
        provider: 'local',
        api: 'openai-completions',
        baseUrl: 'https://transcript.invalid/v1',
        contextWindow: 4096,
        maxTokens: 512,
        input: ['text', 'image'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      })),
    }),
  );
  let filesAvailable = true;
  const session = api.createAgentSession({
    models,
    model: 'small',
    contextFiles: false,
    skills: false,
    compaction: { enabled: false },
    host: {
      root: '/',
      async close() {},
      capabilities: () =>
        filesAvailable
          ? {
              files: {
                read: (path: string) => vfs.readFileText(path),
                list: async (path: string) =>
                  (await vfs.readdir(path)).map((e) => ({
                    path: `/${e.name}`,
                    kind: e.isDirectory ? ('dir' as const) : ('file' as const),
                  })),
                async change(path: string, transform: (current: string | null) => string | null) {
                  const next = transform(
                    (await vfs.exists(path)) ? await vfs.readFileText(path) : null,
                  );
                  if (next === null) await vfs.rm(path);
                  else await vfs.writeFile(path, next);
                },
              },
            }
          : { notes: ['File access unavailable.'] },
    },
    ...options,
  });
  return {
    session,
    vfs,
    wire,
    disableFiles: () => {
      filesAvailable = false;
    },
  };
}
const call = (name: string, args: Record<string, unknown>) => ({ name, args });
const tools = (state: State) =>
  state.items.filter((item): item is Extract<Item, { kind: 'tool' }> => item.kind === 'tool');
function replay(events: readonly { event: AgentSessionEvent }[]) {
  const { create, reduce } = projection();
  const snapshots: { event: AgentSessionEvent; state: State }[] = [];
  let state = create();
  for (const { event } of events) {
    const previous = structuredClone(state);
    Object.freeze(state.items);
    Object.freeze(state);
    state = reduce(state, event);
    expect(snapshots.at(-1)?.state ?? previous).toEqual(previous);
    snapshots.push({ event, state });
  }
  return { state, snapshots };
}

describe('headless transcript over actual agent events', () => {
  it('keeps streaming separate from final messages and deduplicates tool lifecycle receipts', async () => {
    const f = await fixture([
      [
        call('write_file', { path: 'one.txt', content: 'one' }),
        call('read_file', { path: 'one.txt' }),
      ],
      'Finished.',
    ]);
    try {
      await f.session.send('Write and read');
      const trace = await f.session.exportTrace();
      const { state, snapshots } = replay(trace.events);
      expect(state.status).toBe('done');
      expect(
        state.items.filter((item) => item.kind === 'message').map((item) => item.role),
      ).toEqual(['user', 'assistant', 'assistant']);
      expect(tools(state).map((item) => [item.callId, item.state])).toEqual([
        ['call-0-0', 'success'],
        ['call-0-1', 'success'],
      ]);
      expect(new Set(state.items.map((item) => item.id)).size).toBe(state.items.length);
      expect(await f.vfs.readFileText('/one.txt')).toBe('one');
      const live = snapshots
        .filter(({ event }) => event.type === 'agent' && event.event.type === 'message_update')
        .flatMap(({ state }) =>
          state.items.filter(
            (item) => item.kind === 'message' && item.streamingText === 'Finished.',
          ),
        );
      expect(live.length).toBeGreaterThan(0);
      expect(live[0]).toMatchObject({ text: '' });
      expect(live[0]).not.toHaveProperty('message');
      const final = state.items.filter((item) => item.kind === 'message').at(-1)!;
      expect(final).toMatchObject({
        text: 'Finished.',
        message: { role: 'assistant', stopReason: 'stop' },
      });
      expect(final).not.toHaveProperty('streamingText');
      expect(JSON.stringify(tools(state)[1]?.result?.content)).toContain('one');
    } finally {
      await f.session.dispose();
    }
  });

  it('retains completed tools and user rows when budget agent_end contains only the aborted tail', async () => {
    const f = await fixture(
      [
        [
          call('write_file', { path: 'one.txt', content: 'one' }),
          call('write_file', { path: 'two.txt', content: 'two' }),
        ],
        'Unused.',
      ],
      { maxToolCalls: 1 },
    );
    try {
      await f.session.send('Write both');
      const trace = await f.session.exportTrace();
      const { state } = replay(trace.events);
      expect(state.status).toBe('budget-exceeded');
      expect(tools(state).map((item) => item.state)).toEqual(['success', 'cancelled']);
      expect(state.items).toContainEqual(
        expect.objectContaining({ kind: 'message', role: 'user', text: 'Write both' }),
      );
      expect(state.items).toContainEqual(
        expect.objectContaining({
          kind: 'notice',
          event: expect.objectContaining({ type: 'status', status: 'budget-exceeded' }),
        }),
      );
      expect(await f.vfs.exists('/one.txt')).toBe(true);
      expect(await f.vfs.exists('/two.txt')).toBe(false);
    } finally {
      await f.session.dispose();
    }
  });

  it('renders actual file errors, model switches and changed capabilities without erasing history', async () => {
    const f = await fixture([
      [call('read_file', { path: 'missing.txt' })],
      'Missing.',
      'No files.',
    ]);
    try {
      await f.session.send('Read missing');
      f.session.setModel('other');
      f.disableFiles();
      await f.session.send('Continue');
      const { state } = replay((await f.session.exportTrace()).events);
      expect(tools(state)).toHaveLength(1);
      expect(tools(state)[0]?.state).toBe('error');
      expect(state.items).toContainEqual(
        expect.objectContaining({
          kind: 'notice',
          event: { type: 'model', model: 'other', provider: 'local' },
        }),
      );
      const changes = state.items.filter(
        (item) => item.kind === 'notice' && item.event.type === 'capabilities',
      );
      expect(changes).toHaveLength(2);
      expect(changes.at(-1)).toMatchObject({
        event: { tools: [], notes: ['File access unavailable.'] },
      });
      expect(
        state.items
          .filter(
            (item): item is Extract<Item, { kind: 'message' }> =>
              item.kind === 'message' && item.role === 'user',
          )
          .map((item) => item.text),
      ).toEqual(['Read missing', 'Continue']);
    } finally {
      await f.session.dispose();
    }
  });

  it('keeps native retry attempts and compaction markers in the transcript', async () => {
    const retry = await fixture([{ error: 'temporary', status: 503 }, 'Recovered.'], {
      retry: { baseDelayMs: 1, maxRetries: 1 },
    });
    try {
      await retry.session.send('Retry');
      const { state } = replay((await retry.session.exportTrace()).events);
      expect(state.items).toContainEqual(
        expect.objectContaining({
          kind: 'notice',
          event: expect.objectContaining({ type: 'retry', phase: 'start', attempt: 1 }),
        }),
      );
      expect(state.status).toBe('done');
    } finally {
      await retry.session.dispose();
    }
    const compact = await fixture(
      [
        'First.',
        {
          text: 'Second.',
          usage: { prompt_tokens: 3900, completion_tokens: 2, total_tokens: 3902 },
        },
        'Summary.',
      ],
      { compaction: { enabled: true, reserveTokens: 512, keepRecentTokens: 128 } },
    );
    try {
      await compact.session.send('Previous question '.repeat(1000));
      await compact.session.send('Next question '.repeat(200));
      const { state } = replay((await compact.session.exportTrace()).events);
      expect(state.items).toContainEqual(
        expect.objectContaining({
          kind: 'notice',
          event: expect.objectContaining({
            type: 'compaction',
            phase: 'end',
            success: true,
            tokensBefore: 3902,
          }),
        }),
      );
      expect(
        state.items.filter((item) => item.kind === 'message' && item.role === 'user'),
      ).toHaveLength(2);
    } finally {
      await compact.session.dispose();
    }
  });

  it('preserves automatic steering and its actual native user message', async () => {
    const read = call('read_file', { path: 'same.txt' });
    const f = await fixture([[read, read, read], 'Changed approach.']);
    try {
      await f.session.send('Read');
      const { state } = replay((await f.session.exportTrace()).events);
      expect(tools(state)).toHaveLength(3);
      expect(state.items).toContainEqual(
        expect.objectContaining({
          kind: 'notice',
          event: expect.objectContaining({ type: 'repeated-call', count: 3 }),
        }),
      );
      expect(
        state.items.some(
          (item) =>
            item.kind === 'message' &&
            item.role === 'user' &&
            item.text.includes('Repeated tool call'),
        ),
      ).toBe(true);
    } finally {
      await f.session.dispose();
    }
  });
});

it('renders context-exceeded and retains native user image content', async () => {
  const f = await fixture([{ error: 'maximum context length exceeded', status: 400 }]);
  try {
    await f.session.send('Too large');
    const { state } = replay((await f.session.exportTrace()).events);
    expect(state.status).toBe('context-exceeded');
    expect(state.items).toContainEqual(
      expect.objectContaining({
        kind: 'notice',
        event: expect.objectContaining({ type: 'status', status: 'context-exceeded' }),
      }),
    );
  } finally {
    await f.session.dispose();
  }
  const image = {
    type: 'image' as const,
    mimeType: 'image/png',
    data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4H8AAAAASUVORK5CYII=',
  };
  const vision = await fixture(['Seen.']);
  try {
    await vision.session.send('Look', [image]);
    const { state } = replay((await vision.session.exportTrace()).events);
    expect(state.items).toContainEqual(
      expect.objectContaining({
        kind: 'message',
        role: 'user',
        text: 'Look',
        message: expect.objectContaining({ content: expect.arrayContaining([image]) }),
      }),
    );
  } finally {
    await vision.session.dispose();
  }
});
