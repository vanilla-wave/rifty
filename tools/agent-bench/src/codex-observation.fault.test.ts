import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { codexObservation } from './lanes/native-codex.ts';

async function oracle() {
  return JSON.parse(
    await readFile(
      'docs/backlog/distribution/reference/agent-eval-codex-execution-probe.json',
      'utf8',
    ),
  ) as {
    exitCode: number;
    events: Record<string, unknown>[];
  };
}
const wire = (events: unknown[]) => `${events.map((event) => JSON.stringify(event)).join('\n')}\n`;
it('reads actual Codex0.159.3 completion, usage and unique tool events', async () => {
  const reference = await oracle();
  const result = codexObservation(wire(reference.events), '', reference.exitCode);
  expect(result).toMatchObject({
    agentStatus: 'done',
    inputTokens: 51043,
    outputTokens: 249,
    toolCalls: 3,
  });
});
it('rejects failed/completed mixtures and exit0 without a completed turn', async () => {
  const reference = await oracle();
  const failed = { type: 'turn.failed', error: { message: 'interrupted' } };
  expect(codexObservation(wire([failed, ...reference.events]), '', 0).agentStatus).toBe('error');
  expect(
    codexObservation(
      wire(reference.events.filter((event) => event.type !== 'turn.completed')),
      '',
      0,
    ).agentStatus,
  ).toBe('error');
});
it('retains corrupt/incomplete JSONL as explicit unsuccessful evidence', async () => {
  const reference = await oracle();
  for (const bad of ['not-json-line', '{"type":"turn.completed"']) {
    const result = codexObservation(wire(reference.events) + bad, '', 0);
    expect(result.agentStatus).toBe('error');
    expect(JSON.stringify(result.trace)).toContain(
      bad === 'not-json-line' ? bad : 'turn.completed',
    );
  }
});
it('retains observed overshoot and never rescues budget exhaustion with completion', async () => {
  const reference = await oracle();
  for (const budget of ['maxToolCalls', 'runTimeoutMs'] as const) {
    expect(codexObservation(wire(reference.events), '', 0, budget)).toMatchObject({
      agentStatus: 'budget-exceeded',
      toolCalls: 3,
    });
  }
});
