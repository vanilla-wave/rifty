import type { StreamFn } from '@earendil-works/pi-agent-core';
import {
  type AssistantMessage,
  type Context,
  Type,
  createAssistantMessageEventStream,
} from '@earendil-works/pi-ai';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createAgentSession } from './session.ts';
import { standardTools, wrapTool } from './tools.ts';
import type {
  AgentCapabilities,
  AgentCommandResult,
  AgentHost,
  AgentSessionOptions,
  AgentSettings,
} from './types.ts';

const usage = {
  input: 2,
  output: 3,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 5,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function assistant(
  content: AssistantMessage['content'],
  stopReason: 'stop' | 'toolUse' = 'stop',
): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: 'openai-completions',
    provider: 'rifty',
    model: 'callback-selected-model',
    usage,
    stopReason,
    timestamp: Date.now(),
  };
}

function response(message: AssistantMessage) {
  const stream = createAssistantMessageEventStream();
  stream.push({ type: 'start', partial: message });
  stream.push({ type: 'done', reason: message.stopReason as 'stop' | 'toolUse', message });
  return stream;
}

function host(capabilities: AgentCapabilities = {}): AgentHost {
  return { root: '/', capabilities: () => capabilities, async close() {} };
}

function resultText(result: Awaited<ReturnType<ReturnType<typeof wrapTool>['execute']>>): string {
  return result.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

async function executeStandard(capabilities: AgentCapabilities, name: string) {
  const selected = standardTools('/', capabilities, () => {}).find((tool) => tool.name === name);
  if (!selected) throw new Error(`Missing standard tool: ${name}`);
  return wrapTool(selected).execute(
    `call-${name}`,
    name === 'shell' ? { command: 'quiet-command' } : { path: '' },
    undefined,
    undefined,
  );
}

describe('public agent transport contract', () => {
  it('exposes exclusive default and custom transport option types', () => {
    expectTypeOf<{
      host: AgentHost;
      settings: AgentSettings;
    }>().toMatchTypeOf<AgentSessionOptions>();
    expectTypeOf<{ host: AgentHost; streamFn: StreamFn }>().toMatchTypeOf<AgentSessionOptions>();
    expectTypeOf<
      Extract<AgentSessionOptions, { settings: AgentSettings; streamFn: StreamFn }>
    >().toEqualTypeOf<never>();
  });

  it('runs a native custom stream without network settings and traces actual response identity', async () => {
    const contexts: Context[] = [];
    const signals: (AbortSignal | undefined)[] = [];
    const streamFn: StreamFn = (_model, context, options) => {
      contexts.push(context);
      signals.push(options?.signal);
      return response(assistant([{ type: 'text', text: 'callback reply' }]));
    };
    const session = createAgentSession({
      host: host(),
      streamFn,
      maxToolCalls: 7,
      runTimeoutMs: 2_000,
      instructions: ['Consumer instruction.'],
      tools: [
        {
          name: 'consumer_tool',
          label: 'Consumer tool',
          description: 'Consumer-owned domain action',
          parameters: Type.Object({}),
          async execute() {
            return { content: [{ type: 'text' as const, text: 'unused' }] };
          },
        },
      ],
    } as unknown as AgentSessionOptions);
    try {
      await session.send('Use the consumer callback.');
      const trace = await session.exportTrace();
      expect(session.status()).toBe('done');
      expect(contexts).toHaveLength(1);
      expect(contexts[0]?.messages[0]).toMatchObject({ role: 'user' });
      expect(contexts[0]?.systemPrompt).toContain('coding agent');
      expect(contexts[0]?.systemPrompt).toContain('Consumer instruction.');
      expect(contexts[0]?.tools?.map((tool) => tool.name)).toContain('consumer_tool');
      expect(signals[0]).toBeInstanceOf(AbortSignal);
      expect(trace.config).toEqual({
        transport: 'custom',
        maxToolCalls: 7,
        runTimeoutMs: 2_000,
      });
      expect(trace.transcript).toContainEqual(
        expect.objectContaining({
          role: 'assistant',
          api: 'openai-completions',
          provider: 'rifty',
          model: 'callback-selected-model',
          usage,
        }),
      );
    } finally {
      await session.dispose();
    }
  });

  it('rejects missing or mixed transport selection before host/model work', () => {
    let capabilityReads = 0;
    const guardedHost = host();
    const guarded = {
      ...guardedHost,
      capabilities() {
        capabilityReads++;
        return guardedHost.capabilities();
      },
    };
    const streamFn: StreamFn = () => response(assistant([]));
    expect(() => createAgentSession({ host: guarded } as unknown as AgentSessionOptions)).toThrow(
      /exactly one agent transport/i,
    );
    expect(() =>
      createAgentSession({
        host: guarded,
        settings: { baseUrl: 'https://model.invalid/v1', model: 'model' },
        streamFn,
      } as unknown as AgentSessionOptions),
    ).toThrow(/exactly one agent transport/i);
    expect(capabilityReads).toBe(0);
  });

  it('keeps generic network errors free of Playground deployment advice', async () => {
    const session = createAgentSession({
      host: host(),
      settings: { baseUrl: 'https://model.invalid/v1', model: 'model' },
      fetch: async () => {
        throw new TypeError('fetch failed');
      },
    });
    try {
      await session.send('Fail the provider request.');
      expect(session.status()).toBe('error');
      expect(session.detail()).toBeTruthy();
      expect(session.detail()).not.toMatch(/playground|RIFTY_AI_PROXY_TARGET|ai-proxy/i);
    } finally {
      await session.dispose();
    }
  });
});

describe('model-facing standard tool outcomes', () => {
  it('distinguishes every quiet shell outcome and retains its structured details', async () => {
    const outcomes: AgentCommandResult[] = [
      {
        status: 'exited',
        exitCode: 0,
        stdout: '',
        stderr: '',
        worker: 'retained',
        effects: { applied: 'yes' },
      },
      {
        status: 'exited',
        exitCode: 9,
        stdout: '',
        stderr: '',
        worker: 'retained',
        effects: { applied: 'yes' },
      },
      {
        status: 'failed',
        exitCode: null,
        stdout: '',
        stderr: '',
        worker: 'terminated',
        effects: { applied: 'unknown' },
        error: { name: 'Error', message: 'command failed before exit' },
      },
      {
        status: 'cancelled',
        exitCode: null,
        stdout: '',
        stderr: '',
        worker: 'replaced',
        effects: { applied: 'unknown' },
        error: { name: 'AbortError', message: 'stopped' },
      },
    ];
    const texts: string[] = [];
    for (const outcome of outcomes) {
      const result = await executeStandard({ shell: async () => outcome }, 'shell');
      const text = resultText(result);
      texts.push(text);
      expect(text).toContain(`"status":"${outcome.status}"`);
      expect(text).toContain(`"exitCode":${JSON.stringify(outcome.exitCode)}`);
      expect(text).toContain(`"worker":"${outcome.worker}"`);
      expect(text).toContain(`"effects":${JSON.stringify(outcome.effects)}`);
      if (outcome.error) expect(text).toContain(`"error":${JSON.stringify(outcome.error)}`);
      expect(result.details).toMatchObject(outcome);
    }
    expect(new Set(texts).size).toBe(outcomes.length);
  });

  it('distinguishes empty preview HTTP success/failure and caps after metadata', async () => {
    const texts: string[] = [];
    for (const status of [200, 500]) {
      const result = await executeStandard(
        {
          preview: {
            async fetch() {
              return { status, body: '' };
            },
          },
        },
        'preview_fetch',
      );
      const text = resultText(result);
      texts.push(text);
      expect(text).toContain(`"statusCode":${status}`);
      expect(result.details).toMatchObject({ statusCode: status });
    }
    expect(new Set(texts).size).toBe(2);

    const large = await executeStandard(
      {
        shell: async () => ({
          status: 'failed',
          exitCode: null,
          stdout: `BODY_HEAD${'x'.repeat(32_000)}BODY_TAIL`,
          stderr: '',
          worker: 'terminated',
          effects: { applied: 'unknown' },
          error: { name: 'Error', message: 'large failure' },
        }),
      },
      'shell',
    );
    const text = resultText(large);
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(16 * 1024);
    expect(text).toContain('"status":"failed"');
    expect(text).toContain('"worker":"terminated"');
    expect(text).toContain('BODY_TAIL');
  });
});
