import { afterEach, describe, expect, it } from 'vitest';
import { type MockModelServer, startMockModelServer } from './mock-model.ts';

let server: MockModelServer | null = null;
afterEach(async () => {
  if (server) await server.close();
  server = null;
});

async function complete(baseUrl: string, body: unknown): Promise<string[]> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const text = await res.text();
  return text
    .split('\n\n')
    .filter((chunk) => chunk.startsWith('data: '))
    .map((chunk) => chunk.slice('data: '.length));
}

const READ_TOOL = { type: 'function', function: { name: 'read', parameters: {} } };

describe('mock model server', () => {
  it('first completion emits a read(package.json) tool call, finish_reason tool_calls', async () => {
    server = await startMockModelServer();
    const events = await complete(server.baseUrl, {
      model: server.model,
      stream: true,
      tools: [READ_TOOL],
      messages: [{ role: 'user', content: 'do something' }],
    });
    expect(events.at(-1)).toBe('[DONE]');
    const parsed = events.slice(0, -1).map((e) => JSON.parse(e));
    const toolDelta = parsed.find((p) => p.choices?.[0]?.delta?.tool_calls);
    expect(toolDelta.choices[0].delta.tool_calls[0].function.name).toBe('read');
    const args = parsed
      .flatMap((p) => p.choices?.[0]?.delta?.tool_calls ?? [])
      .map((tc: { function?: { arguments?: string } }) => tc.function?.arguments ?? '')
      .join('');
    expect(JSON.parse(args)).toEqual({ path: 'package.json' });
    expect(parsed.some((p) => p.choices?.[0]?.finish_reason === 'tool_calls')).toBe(true);
  });

  it('after a tool result it finishes with text and finish_reason stop', async () => {
    server = await startMockModelServer();
    const events = await complete(server.baseUrl, {
      model: server.model,
      stream: true,
      tools: [READ_TOOL],
      messages: [
        { role: 'user', content: 'do something' },
        { role: 'assistant', tool_calls: [] },
        { role: 'tool', tool_call_id: 'call_agent_bench_mock_1', content: '{}' },
      ],
    });
    const parsed = events.slice(0, -1).map((e) => JSON.parse(e));
    const text = parsed.map((p) => p.choices?.[0]?.delta?.content ?? '').join('');
    expect(text).toContain('Mock run complete');
    expect(parsed.some((p) => p.choices?.[0]?.finish_reason === 'stop')).toBe(true);
  });

  it('rejects unknown routes loudly', async () => {
    server = await startMockModelServer();
    const res = await fetch(`${server.baseUrl}/nope`, { method: 'GET' });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toContain('no route');
  });
});
