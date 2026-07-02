import type { AgentEvent } from '@earendil-works/pi-agent-core';
import { describe, expect, it } from 'vitest';
import { aiConfigSnapshot } from './settings.ts';
import { AiTraceRecorder } from './trace.ts';
import { TOOL_RESULT_CAP_BYTES } from './truncate.ts';

const CONFIG = aiConfigSnapshot({
  baseUrl: 'http://localhost:5273/mock-ai/v1',
  apiKey: 'sk-never-in-traces',
  model: 'mock-model',
  maxToolCalls: 5,
  runTimeoutMs: 60_000,
});

function ev(value: unknown): AgentEvent {
  return value as AgentEvent;
}

function textResult(text: string, details: Record<string, unknown> = {}): unknown {
  return { content: [{ type: 'text', text }], details };
}

describe('AiTraceRecorder', () => {
  it('builds the full trace shape — and never contains the apiKey', () => {
    let now = 1_000;
    const recorder = new AiTraceRecorder(CONFIG, () => now);
    recorder.onEvent(ev({ type: 'agent_start' }));
    recorder.onEvent(
      ev({ type: 'message_end', message: { role: 'user', content: 'make a file', timestamp: 1 } }),
    );
    recorder.onEvent(
      ev({
        type: 'tool_execution_start',
        toolCallId: 'c1',
        toolName: 'write_file',
        args: { path: 'src/hello.txt', content: 'hi' },
      }),
    );
    now = 1_250;
    recorder.onEvent(
      ev({
        type: 'tool_execution_end',
        toolCallId: 'c1',
        toolName: 'write_file',
        result: textResult('wrote 2 bytes to src/hello.txt'),
        isError: false,
      }),
    );
    recorder.onEvent(
      ev({
        type: 'tool_execution_start',
        toolCallId: 'c2',
        toolName: 'shell',
        args: { command: 'node -v' },
      }),
    );
    now = 1_500;
    recorder.onEvent(
      ev({
        type: 'tool_execution_end',
        toolCallId: 'c2',
        toolName: 'shell',
        result: textResult('exit code: 0\nv24.0.0', { command: 'node -v', exitCode: 0 }),
        isError: false,
      }),
    );
    recorder.onEvent(
      ev({
        type: 'message_end',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'done' }],
          usage: { input: 10, output: 5, totalTokens: 15 },
          stopReason: 'stop',
          timestamp: 2,
        },
      }),
    );
    now = 2_000;
    recorder.onEvent(ev({ type: 'agent_end', messages: [] }));
    recorder.setStatus('done');

    const trace = recorder.snapshot([]);
    expect(trace.version).toBe(1);
    expect(trace.profile).toBe('pi-baseline+rifty-adapter-v1');
    expect(trace.caps).toEqual({ toolResultBytes: TOOL_RESULT_CAP_BYTES });
    expect(trace.transcript.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(trace.toolCalls).toHaveLength(2);
    expect(trace.toolCalls[0]).toMatchObject({
      id: 'c1',
      name: 'write_file',
      durationMs: 250,
      isError: false,
    });
    expect(trace.terminal).toEqual([
      { command: 'node -v', exitCode: 0, output: 'exit code: 0\nv24.0.0' },
    ]);
    expect(trace.usage).toEqual({ input: 10, output: 5, totalTokens: 15 });
    expect(trace.timings.runs).toEqual([{ startedAt: 1_000, endedAt: 2_000 }]);
    expect(trace.status).toBe('done');
    expect(trace.budget).toEqual({ exceeded: false });
    expect(trace.finalDiff).toEqual([]);
    // The key must be structurally impossible in a trace, not just filtered.
    expect(JSON.stringify(trace)).not.toContain('sk-never-in-traces');
    expect(JSON.stringify(trace)).not.toContain('apiKey');
  });

  it('caps oversized tool results and transcript text', () => {
    const recorder = new AiTraceRecorder(CONFIG, () => 0);
    recorder.onEvent(
      ev({ type: 'tool_execution_start', toolCallId: 'c1', toolName: 'read_file', args: {} }),
    );
    recorder.onEvent(
      ev({
        type: 'tool_execution_end',
        toolCallId: 'c1',
        toolName: 'read_file',
        result: textResult('y'.repeat(TOOL_RESULT_CAP_BYTES * 3)),
        isError: false,
      }),
    );
    const trace = recorder.snapshot([]);
    expect(trace.toolCalls[0]?.result).toContain('bytes]');
    expect((trace.toolCalls[0]?.result ?? '').length).toBeLessThan(TOOL_RESULT_CAP_BYTES + 64);
  });

  it('budget-exceeded is a distinct recorded outcome', () => {
    const recorder = new AiTraceRecorder(CONFIG, () => 0);
    recorder.markBudgetExceeded('budget-exceeded: max tool calls (5) reached');
    const trace = recorder.snapshot({ error: 'no repo' });
    expect(trace.status).toBe('budget-exceeded');
    expect(trace.budget).toEqual({
      exceeded: true,
      reason: 'budget-exceeded: max tool calls (5) reached',
    });
    expect(trace.finalDiff).toEqual({ error: 'no repo' });
  });

  it('records error tool results with isError', () => {
    const recorder = new AiTraceRecorder(CONFIG, () => 0);
    recorder.onEvent(
      ev({ type: 'tool_execution_start', toolCallId: 'c1', toolName: 'edit_file', args: {} }),
    );
    recorder.onEvent(
      ev({
        type: 'tool_execution_end',
        toolCallId: 'c1',
        toolName: 'edit_file',
        result: textResult('edit_file: string not found in src/main.js'),
        isError: true,
      }),
    );
    expect(recorder.snapshot([]).toolCalls[0]).toMatchObject({
      isError: true,
      result: 'edit_file: string not found in src/main.js',
    });
  });
});
