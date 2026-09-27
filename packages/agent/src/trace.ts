import type { AgentTrace } from './types.ts';

// Public Pi/Rifty tags identify events; matching credential text is not their source.
const tags = new Set([
  'user',
  'assistant',
  'toolResult',
  'compactionSummary',
  'idle',
  'running',
  'done',
  'error',
  'aborted',
  'budget-exceeded',
  'exited',
  'cancelled',
  'failed',
  'pending',
  'stop',
  'length',
  'toolUse',
  'deferred',
  'model',
  'resources',
  'agent',
  'status',
  'capabilities',
  'output',
  'agent_start',
  'agent_end',
  'turn_start',
  'turn_end',
  'message_start',
  'message_update',
  'message_end',
  'tool_execution_start',
  'tool_execution_update',
  'tool_execution_end',
  'start',
  'text_start',
  'text_delta',
  'text_end',
  'thinking_start',
  'thinking_delta',
  'thinking_end',
  'toolcall_start',
  'toolcall_delta',
  'toolcall_end',
  'text',
  'thinking',
  'toolCall',
  'image',
]);

export function redactTrace(trace: AgentTrace, secrets: ReadonlySet<string>): AgentTrace {
  const serialized = JSON.stringify(trace, (field, value: unknown) => {
    if (field === 'headers' && value && typeof value === 'object' && !Array.isArray(value))
      return Object.fromEntries(
        Object.entries(value).map(([name, header]) => [
          name,
          typeof header === 'string' ? '[redacted]' : header,
        ]),
      );
    if (typeof value !== 'string') return value;
    if (['type', 'role', 'stopReason', 'status'].includes(field) && tags.has(value)) return value;
    let text = value;
    for (const secret of secrets) if (secret) text = text.split(secret).join('[redacted]');
    return text;
  });
  return JSON.parse(serialized) as AgentTrace;
}
