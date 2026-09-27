import { describe, expect, it } from 'vitest';
import { modelCatalog } from '../../../tests/integration/fixtures/workbench-vite-consumer/src/agent-catalog.ts';
import {
  type ScriptedReply,
  scriptedProvider,
} from '../../../tests/integration/fixtures/workbench-vite-consumer/src/agent-scripted-provider.ts';
import { MemoryVfs } from '../../vfs/src/index.ts';
import {
  type AgentCapabilities,
  type AgentSessionOptions,
  Type,
  createAgentSession,
  getAgentPromptProfile,
} from './index.ts';
import { toolReceipt } from './tool-feedback.ts';

async function fixture(
  replies: readonly ScriptedReply[],
  options: Partial<AgentSessionOptions> & { recipe?: boolean } = {},
  diagnostics?: AgentCapabilities['diagnostics'],
) {
  const vfs = new MemoryVfs();
  await vfs.writeFile('/one.txt', 'hello');
  let writes = 0;
  const wire = scriptedProvider(replies);
  const session = createAgentSession({
    host: {
      root: '/',
      async close() {},
      capabilities: () => ({
        files: {
          read: (path: string) => vfs.readFileText(path),
          list: async (path: string) =>
            (await vfs.readdir(path)).map((entry) => ({
              path: `${path.replace(/\/$/, '')}/${entry.name}`,
              kind: entry.isDirectory ? ('dir' as const) : ('file' as const),
            })),
          async change(path: string, transform: (value: string | null) => string | null) {
            const next = transform((await vfs.exists(path)) ? await vfs.readFileText(path) : null);
            if (next === null) await vfs.rm(path);
            else await vfs.writeFile(path, next);
            writes++;
          },
        },
        ...(diagnostics ? { diagnostics } : {}),
      }),
    },
    ...modelCatalog(undefined, wire.fetch),
    ...options,
  });
  return { session, vfs, wire, writes: () => writes };
}
const call = (name: string, args: Record<string, unknown>) => ({ name, args });
function text(message: { content: unknown }) {
  return Array.isArray(message.content)
    ? message.content
        .map((block) => (typeof block === 'object' && block && 'text' in block ? block.text : ''))
        .join('\n')
    : '';
}
function envelope(value: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(value.split('\n')[0]!);
  } catch {
    return undefined;
  }
}
const repeated = (events: readonly { event: { type: string } }[]) =>
  events.filter(({ event }) => event.type === 'repeated-call');

describe('honest tool feedback', () => {
  it('uses 600s/100 defaults and decorates actual success, invalid and missing-tool receipts on wire', async () => {
    const f = await fixture([
      [
        call('read_file', { path: 'one.txt' }),
        call('read_file', {}),
        call('missing', {}),
        call('write_file', { path: 'one.txt', content: 'updated' }),
      ],
      'Done',
    ]);
    try {
      await f.session.send('work');
      const trace = await f.session.exportTrace();
      expect(trace.config).toMatchObject({ runTimeoutMs: 600000, maxToolCalls: 100 });
      const results = trace.transcript.filter((message) => message.role === 'toolResult');
      expect(results.map((result) => envelope(text(result))?.callsLeft)).toEqual([99, 99, 99, 98]);
      for (const result of results)
        expect(envelope(text(result))?.msLeft).toEqual(expect.any(Number));
      const wire = f.wire.requests[1]!.body.messages.filter((message) => message.role === 'tool');
      expect(wire.map((message) => message.content)).toEqual(results.map(text));
      expect(await f.vfs.readFileText('/one.txt')).toBe('updated');
    } finally {
      await f.session.dispose();
    }
  });
  it('[fault: provenance-lie] admission exhaustion reports zero calls without another write', async () => {
    const f = await fixture(
      [
        [
          call('write_file', { path: 'one.txt', content: 'one' }),
          call('write_file', { path: 'one.txt', content: 'two' }),
        ],
      ],
      { maxToolCalls: 1 },
    );
    try {
      await f.session.send('work');
      expect(f.session.status()).toBe('budget-exceeded');
      expect(f.writes()).toBe(1);
      const results = (await f.session.exportTrace()).transcript.filter(
        (message) => message.role === 'toolResult',
      );
      expect(results).toHaveLength(2);
      expect(results.map((message) => envelope(text(message))?.callsLeft)).toEqual([0, 0]);
      expect(await f.vfs.readFileText('/one.txt')).toBe('one');
    } finally {
      await f.session.dispose();
    }
  });
  it('[fault: lossy-aggregate] keeps a complete budget heading and bounded Unicode body', async () => {
    const f = await fixture([[call('read_file', { path: 'one.txt' })], 'Done']);
    await f.vfs.writeFile('/one.txt', `HEAD${'🙂'.repeat(10000)}TAIL`);
    try {
      await f.session.send('read');
      const result = (await f.session.exportTrace()).transcript.find(
        (message) => message.role === 'toolResult',
      )!;
      expect(envelope(text(result))).toMatchObject({ callsLeft: 99, msLeft: expect.any(Number) });
      expect(new TextEncoder().encode(text(result)).length).toBeLessThanOrEqual(16384);
      expect(text(result)).toContain('HEAD');
      expect(text(result)).toContain('TAIL');
      expect(text(result)).toContain('[truncated');
    } finally {
      await f.session.dispose();
    }
  });
  it.each([
    ['same\n x \nsame\nsame\n', 'same', /3 matches[\s\S]*1[\s\S]*3[\s\S]*4/],
    ['ababa', 'aba', /2 matches/],
    [
      'const zero = 0;\n  const answer = 42;\n',
      '\tconst answer=42;',
      /0 matches[\s\S]*hint[\s\S]*line 2/i,
    ],
  ])(
    'exact edit reports locating information without writing (%s)',
    async (content, old, expected) => {
      const f = await fixture([
        [call('edit_file', { path: 'one.txt', old, new: 'wrong' })],
        'Done',
      ]);
      await f.vfs.writeFile('/one.txt', content);
      try {
        await f.session.send('edit');
        const result = (await f.session.exportTrace()).transcript.find(
          (message) => message.role === 'toolResult',
        )!;
        expect(result).toHaveProperty('isError', true);
        expect(text(result)).toMatch(expected);
        expect(await f.vfs.readFileText('/one.txt')).toBe(content);
        expect(f.writes()).toBe(0);
      } finally {
        await f.session.dispose();
      }
    },
  );
  it('steers after third equal result despite budget changes/key order and executes the fourth batch call', async () => {
    const f = await fixture([
      [
        call('write_file', { path: 'one.txt', content: 'same' }),
        call('write_file', { content: 'same', path: 'one.txt' }),
        call('write_file', { path: 'one.txt', content: 'same' }),
        call('write_file', { path: 'one.txt', content: 'same' }),
      ],
      'Done',
    ]);
    try {
      await f.session.send('write');
      expect(f.writes()).toBe(4);
      const trace = await f.session.exportTrace();
      expect(repeated(trace.events)).toHaveLength(1);
      expect(JSON.stringify(f.wire.requests[1]?.body.messages)).toMatch(/repeat[\s\S]*write_file/i);
      expect(trace.transcript.filter((message) => message.role === 'toolResult')).toHaveLength(4);
    } finally {
      await f.session.dispose();
    }
  });
  it('preserves consecutive-call state across sends and clears it on reset', async () => {
    const same = call('read_file', { path: 'one.txt' });
    const f = await fixture([[same, same], 'One', [same], 'Two', [same, same], 'Three']);
    try {
      await f.session.send('first');
      await f.session.send('second');
      expect(repeated((await f.session.exportTrace()).events)).toHaveLength(1);
      f.session.reset();
      await f.session.send('fresh');
      expect(repeated((await f.session.exportTrace()).events)).toHaveLength(0);
    } finally {
      await f.session.dispose();
    }
  });
  it('leaves consumer JSON-looking text alone and treats nested budget names as result data', async () => {
    const body = '{"status":"exited","exitCode":0}\nconsumer body';
    let count = 0;
    const f = await fixture(
      [
        [call('plain', {}), call('changing', {}), call('changing', {}), call('changing', {})],
        'Done',
      ],
      {
        tools: [
          {
            name: 'plain',
            label: 'Plain',
            description: 'Consumer text',
            parameters: Type.Object({}),
            async execute() {
              return { content: [{ type: 'text', text: body }], details: { custom: true } };
            },
          },
          {
            name: 'changing',
            label: 'Changing',
            description: 'Consumer data',
            parameters: Type.Object({}),
            async execute() {
              return {
                content: [
                  { type: 'text', text: JSON.stringify({ nested: { callsLeft: ++count } }) },
                ],
                details: { custom: true },
              };
            },
          },
        ],
      },
    );
    try {
      await f.session.send('work');
      const trace = await f.session.exportTrace();
      expect(text(trace.transcript.find((message) => message.role === 'toolResult')!)).toBe(body);
      expect(repeated(trace.events)).toHaveLength(0);
    } finally {
      await f.session.dispose();
    }
  });
  it('reports unavailable diagnostics after a real successful mutation', async () => {
    const f = await fixture([
      [call('write_file', { path: 'one.txt', content: 'written' })],
      'Done',
    ]);
    try {
      await f.session.send('write');
      const result = (await f.session.exportTrace()).transcript.find(
        (message) => message.role === 'toolResult',
      )!;
      expect(result).toHaveProperty('isError', false);
      expect(text(result)).toMatch(/diagnostics:\s*unavailable/i);
      expect(await f.vfs.readFileText('/one.txt')).toBe('written');
    } finally {
      await f.session.dispose();
    }
  });
  it('[fault: unbounded-read] bounds a stalled diagnostics boundary without losing the write', async () => {
    const f = await fixture(
      [[call('write_file', { path: 'one.txt', content: 'written' })], 'Done'],
      {},
      () => new Promise(() => {}),
    );
    try {
      await f.session.send('write');
      const result = (await f.session.exportTrace()).transcript.find(
        (message) => message.role === 'toolResult',
      )!;
      expect(result).toHaveProperty('isError', false);
      expect(text(result)).toMatch(/diagnostics:\s*pending/i);
      expect(await f.vfs.readFileText('/one.txt')).toBe('written');
    } finally {
      await f.session.dispose();
    }
  });
  it('adds a shared v2 recipe by default, with a traceable opt-out', async () => {
    const on = await fixture(['Done']);
    const off = await fixture(['Done'], { recipe: false });
    try {
      await on.session.send('work');
      await off.session.send('work');
      const profile = getAgentPromptProfile() as unknown as { id: string; recipe: string };
      expect(profile.id).toBe('pi-0.85.1+rifty-adapter-v2');
      expect(profile.recipe).toBeTruthy();
      for (const step of [/locat/i, /reproduc|inspect/i, /chang/i, /re.?run|verif/i, /edge/i])
        expect(profile.recipe).toMatch(step);
      expect(profile.recipe).not.toContain('\n\n');
      const prompt = (f: typeof on) =>
        String(
          f.wire.requests[0]!.body.messages.find((message) => message.role === 'system')?.content,
        );
      expect(prompt(on)).toContain(profile.recipe);
      expect(prompt(off)).not.toContain(profile.recipe);
      expect((await on.session.exportTrace()).config).toHaveProperty('recipe', true);
      expect((await off.session.exportTrace()).config).toHaveProperty('recipe', false);
    } finally {
      await on.session.dispose();
      await off.session.dispose();
    }
  });
  it('adds budgets to a corroborated preexisting consumer envelope', async () => {
    const metadata = { status: 'exited', exitCode: 0, worker: 'retained' };
    const f = await fixture([[call('external', {})], 'Done'], {
      tools: [
        {
          name: 'external',
          label: 'External',
          description: 'Consumer envelope',
          parameters: Type.Object({}),
          async execute() {
            return {
              content: [{ type: 'text', text: `${JSON.stringify(metadata)}\nconsumer body` }],
              details: metadata,
            };
          },
        },
      ],
    });
    try {
      await f.session.send('work');
      const result = (await f.session.exportTrace()).transcript.find(
        (message) => message.role === 'toolResult',
      )!;
      expect(envelope(text(result))).toMatchObject({
        ...metadata,
        callsLeft: 99,
        msLeft: expect.any(Number),
      });
      expect(text(result)).toContain('consumer body');
    } finally {
      await f.session.dispose();
    }
  });
  it('[fault: provenance-lie] host failure and cancelled batch members retain budget receipts without invented effects', async () => {
    const f = await fixture([
      [
        call('read_file', { path: 'absent.txt' }),
        call('write_file', { path: 'one.txt', content: 'once' }),
        call('write_file', { path: 'never.txt', content: 'wrong' }),
      ],
    ]);
    f.session.subscribe((event) => {
      if (
        event.type === 'agent' &&
        event.event.type === 'tool_execution_end' &&
        event.event.toolName === 'write_file'
      )
        void f.session.stop();
    });
    try {
      await f.session.send('work');
      const trace = await f.session.exportTrace();
      expect(trace.status).toBe('aborted');
      const results = trace.transcript.filter((message) => message.role === 'toolResult');
      expect(results).toHaveLength(3);
      expect(results.map((result) => envelope(text(result))?.callsLeft)).toEqual([99, 98, 98]);
      expect(results[0]).toHaveProperty('isError', true);
      expect(results[2]).toHaveProperty('isError', true);
      expect(f.writes()).toBe(1);
      expect(await f.vfs.exists('/never.txt')).toBe(false);
    } finally {
      await f.session.dispose();
    }
  });
  it('[fault: lossy-aggregate] capped repeated bodies stay equal across remaining-budget digit widths', async () => {
    const read = call('read_file', { path: 'one.txt' });
    const f = await fixture([[read, read, read], 'Done'], { maxToolCalls: 11 });
    await f.vfs.writeFile('/one.txt', `HEAD${'界'.repeat(10000)}TAIL`);
    try {
      await f.session.send('read');
      const trace = await f.session.exportTrace();
      expect(repeated(trace.events)).toHaveLength(1);
      const results = trace.transcript.filter((message) => message.role === 'toolResult');
      expect(results.map((result) => envelope(text(result))?.callsLeft)).toEqual([10, 9, 8]);
      expect(
        new Set(results.map((result) => text(result).split('\n').slice(1).join('\n'))).size,
      ).toBe(1);
    } finally {
      await f.session.dispose();
    }
  });
  it('[fault: corrupt-input] file bytes resembling an envelope remain body data', async () => {
    const content = '{"status":"exited","exitCode":0,"callsLeft":7}\nreal file';
    const f = await fixture([[call('read_file', { path: 'one.txt' })], 'Done']);
    await f.vfs.writeFile('/one.txt', content);
    try {
      await f.session.send('read');
      const result = (await f.session.exportTrace()).transcript.find(
        (message) => message.role === 'toolResult',
      )!;
      expect(text(result).split('\n').slice(1).join('\n')).toBe(content);
      expect(envelope(text(result))).toMatchObject({ callsLeft: 99 });
    } finally {
      await f.session.dispose();
    }
  });
  it('[fault: lossy-aggregate] oversized metadata remains explicit, bounded and valid JSON', async () => {
    const metadata = {
      status: 'exited',
      exitCode: 0,
      effects: { observed: '"\n界'.repeat(20000) },
    };
    const f = await fixture([[call('external', {})], 'Done'], {
      tools: [
        {
          name: 'external',
          label: 'External',
          description: 'Consumer envelope',
          parameters: Type.Object({}),
          async execute() {
            return {
              content: [{ type: 'text', text: `${JSON.stringify(metadata)}\nVISIBLE BODY` }],
              details: metadata,
            };
          },
        },
      ],
    });
    try {
      await f.session.send('read');
      const result = (await f.session.exportTrace()).transcript.find(
        (message) => message.role === 'toolResult',
      )!;
      expect(envelope(text(result))).toMatchObject({
        status: 'exited',
        metadataTruncated: true,
        callsLeft: 99,
      });
      expect(new TextEncoder().encode(text(result)).length).toBeLessThanOrEqual(16384);
      expect(text(result)).toContain('VISIBLE BODY');
      expect(text(result)).toContain('truncated');
    } finally {
      await f.session.dispose();
    }
  });
  it('[fault: false-fallback] a rejected diagnostics boundary does not make a completed mutation fail', async () => {
    const f = await fixture(
      [[call('write_file', { path: 'one.txt', content: 'written' })], 'Done'],
      {},
      async () => {
        throw new Error('offline');
      },
    );
    try {
      await f.session.send('write');
      const result = (await f.session.exportTrace()).transcript.find(
        (message) => message.role === 'toolResult',
      )!;
      expect(result).toHaveProperty('isError', false);
      expect(text(result)).toMatch(/diagnostics:[\s\S]*unavailable[\s\S]*offline/);
      expect(await f.vfs.readFileText('/one.txt')).toBe('written');
    } finally {
      await f.session.dispose();
    }
  });
  it('[fault: torn-state] late rejected diagnostics cannot alter a pending receipt or become unhandled', async () => {
    let reject!: (error: Error) => void;
    const delayed = new Promise<unknown>((_resolve, no) => {
      reject = no;
    });
    const f = await fixture(
      [[call('write_file', { path: 'one.txt', content: 'written' })], 'Done'],
      {},
      () => delayed,
    );
    try {
      await f.session.send('write');
      const before = text(
        (await f.session.exportTrace()).transcript.find(
          (message) => message.role === 'toolResult',
        )!,
      );
      expect(before).toContain('diagnostics: pending');
      reject(new Error('late failure'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(
        text(
          (await f.session.exportTrace()).transcript.find(
            (message) => message.role === 'toolResult',
          )!,
        ),
      ).toBe(before);
    } finally {
      await f.session.dispose();
    }
  });
  it('marks a deleted patch path unavailable without reading it through diagnostics', async () => {
    let reads = 0;
    const f = await fixture(
      [
        [call('apply_patch', { patch: '--- a/one.txt\n+++ /dev/null\n@@ -1 +0,0 @@\n-hello\n' })],
        'Done',
      ],
      {},
      async () => {
        reads++;
        throw new Error('deleted file must not open');
      },
    );
    await f.vfs.writeFile('/one.txt', 'hello\n');
    try {
      await f.session.send('delete');
      expect(await f.vfs.exists('/one.txt')).toBe(false);
      expect(reads).toBe(0);
      const result = (await f.session.exportTrace()).transcript.find(
        (message) => message.role === 'toolResult',
      )!;
      expect(result).toHaveProperty('isError', false);
      expect(text(result)).toMatch(/diagnostics:[\s\S]*unavailable[\s\S]*deleted/);
    } finally {
      await f.session.dispose();
    }
  });
  it('resets remaining budget for each send without resetting the conversation', async () => {
    const read = call('read_file', { path: 'one.txt' });
    const f = await fixture([[read], 'One', [read], 'Two'], { maxToolCalls: 2 });
    try {
      await f.session.send('one');
      await f.session.send('two');
      const results = (await f.session.exportTrace()).transcript.filter(
        (message) => message.role === 'toolResult',
      );
      expect(results.map((result) => envelope(text(result))?.callsLeft)).toEqual([1, 1]);
    } finally {
      await f.session.dispose();
    }
  });
  it('steers on the third identical failed exact edit while preserving the file', async () => {
    const edit = call('edit_file', { path: 'one.txt', old: 'absent', new: 'wrong' });
    const f = await fixture([[edit, edit, edit], 'Done']);
    try {
      await f.session.send('edit');
      const trace = await f.session.exportTrace();
      expect(repeated(trace.events)).toHaveLength(1);
      expect(f.writes()).toBe(0);
      expect(await f.vfs.readFileText('/one.txt')).toBe('hello');
      expect(
        trace.transcript.filter((message) => message.role === 'toolResult' && message.isError),
      ).toHaveLength(3);
    } finally {
      await f.session.dispose();
    }
  });
  it('[fault: false-fallback] unrenderable host diagnostics cannot report a completed write as failed', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const f = await fixture(
      [[call('write_file', { path: 'one.txt', content: 'written' })], 'Done'],
      {},
      async () => [cyclic],
    );
    try {
      await f.session.send('write');
      const result = (await f.session.exportTrace()).transcript.find(
        (message) => message.role === 'toolResult',
      )!;
      expect(await f.vfs.readFileText('/one.txt')).toBe('written');
      expect(result).toHaveProperty('isError', false);
      expect(text(result)).toMatch(/diagnostics:[\s\S]*unavailable/);
    } finally {
      await f.session.dispose();
    }
  });
  it('does not mistake array-valued consumer status for the closed Rifty envelope grammar', async () => {
    const metadata = { status: ['exited'], exitCode: 0 };
    const body = `${JSON.stringify(metadata)}\nconsumer data`;
    const f = await fixture([[call('external', {})], 'Done'], {
      tools: [
        {
          name: 'external',
          label: 'External',
          description: 'Consumer data',
          parameters: Type.Object({}),
          async execute() {
            return { content: [{ type: 'text', text: body }], details: metadata };
          },
        },
      ],
    });
    try {
      await f.session.send('read');
      expect(
        text(
          (await f.session.exportTrace()).transcript.find(
            (message) => message.role === 'toolResult',
          )!,
        ),
      ).toBe(body);
    } finally {
      await f.session.dispose();
    }
  });
  it.each([2500, 6000])(
    '[fault: provenance-lie] preserves all fitting shell effects on model wire (%s)',
    async (size) => {
      const effects = {
        description: 'a'.repeat(size),
        applied: 'unknown',
        context: 'b'.repeat(size),
      };
      const f = await fixture([[call('shell', { command: 'probe' })], 'Done'], {
        host: {
          root: '/',
          async close() {},
          capabilities: () => ({
            shell: async () => ({
              status: 'cancelled',
              exitCode: null,
              stdout: 'actual body',
              stderr: '',
              worker: 'terminated',
              effects,
            }),
          }),
        },
      });
      try {
        await f.session.send('inspect effects');
        const result = (await f.session.exportTrace()).transcript.find(
          (message) => message.role === 'toolResult',
        )!;
        const header = envelope(text(result));
        expect(header?.effects).toEqual(effects);
        expect(header).not.toHaveProperty('metadataTruncated');
        expect(new TextEncoder().encode(text(result)).length).toBeLessThanOrEqual(16384);
        expect(
          f.wire.requests[1]?.body.messages.find((message) => message.role === 'tool')?.content,
        ).toBe(text(result));
      } finally {
        await f.session.dispose();
      }
    },
  );
  it('keeps one normalized shell envelope when the host supplies an Error object', async () => {
    const f = await fixture([[call('shell', { command: 'probe' })], 'Done'], {
      host: {
        root: '/',
        async close() {},
        capabilities: () => ({
          shell: async () => ({
            status: 'failed',
            exitCode: null,
            stdout: '',
            stderr: 'actual body',
            error: new Error('host failure'),
          }),
        }),
      },
    });
    try {
      await f.session.send('inspect');
      const result = (await f.session.exportTrace()).transcript.find(
        (message) => message.role === 'toolResult',
      )!;
      expect(envelope(text(result))).toMatchObject({
        error: { name: 'Error', message: 'host failure' },
        callsLeft: 99,
      });
      expect(text(result).split('\n').slice(1).join('\n')).toBe('actual body');
    } finally {
      await f.session.dispose();
    }
  });

  it('[fault: provenance-lie] oversized effects keep their applied and persistence outcome explicit', async () => {
    const effects = {
      description: 'a'.repeat(20000),
      applied: 'unknown',
      persistence: 'failed',
      context: 'b'.repeat(20000),
    };
    const f = await fixture([[call('shell', { command: 'probe' })], 'Done'], {
      host: {
        root: '/',
        async close() {},
        capabilities: () => ({
          shell: async () => ({
            status: 'cancelled',
            exitCode: null,
            stdout: 'body',
            stderr: '',
            worker: 'terminated',
            effects,
          }),
        }),
      },
    });
    try {
      await f.session.send('inspect');
      const result = (await f.session.exportTrace()).transcript.find(
        (message) => message.role === 'toolResult',
      )!;
      expect(envelope(text(result))).toMatchObject({
        effects: { applied: 'unknown', persistence: 'failed' },
        metadataTruncated: true,
      });
      expect(new TextEncoder().encode(text(result)).length).toBeLessThanOrEqual(16384);
    } finally {
      await f.session.dispose();
    }
  });
  it('[fault: lossy-aggregate] oversized patch/error metadata retains bounded explicit settlement facts', () => {
    const applied = Array.from({ length: 2000 }, (_, index) => `changed-${index}.txt`);
    const result = {
      content: [{ type: 'text' as const, text: 'Patch failed after 2000 acknowledged changes' }],
      details: {
        status: 'failed',
        applied,
        error: {
          description: 'x'.repeat(20000),
          mutationOutcome: 'unknown',
          effects: { applied: 'yes', persistence: 'failed' },
          context: 'y'.repeat(20000),
        },
      },
    };
    toolReceipt(
      result,
      'apply_patch',
      true,
      true,
      { callsLeft: 9, msLeft: 999 },
      { maxToolCalls: 10, runTimeoutMs: 1000 },
    );
    const header = envelope(text(result));
    expect(header).toMatchObject({
      applied: {
        count: 2000,
        paths: ['changed-0.txt', 'changed-1.txt', 'changed-1999.txt'],
        omitted: 1997,
      },
      error: { mutationOutcome: 'unknown', effects: { applied: 'yes', persistence: 'failed' } },
      metadataTruncated: true,
    });
    expect(new TextEncoder().encode(text(result)).length).toBeLessThanOrEqual(16384);
  });
});
