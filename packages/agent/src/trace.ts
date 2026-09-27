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
  'context-exceeded',
  'retry',
  'repeated-call',
  'compaction',
  'end',
  'summary',
  'threshold',
  'overflow',
  'estimate',
  'usage',
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

function privateText(text: string, secrets: ReadonlySet<string>): string {
  let result = text;
  for (const secret of secrets)
    if (secret)
      result = result
        .split(JSON.stringify(secret).slice(1, -1))
        .join('[redacted]')
        .split(secret)
        .join('[redacted]');
  return result;
}

export function redactTrace(trace: AgentTrace, secrets: ReadonlySet<string>): AgentTrace {
  function serialize(value: unknown, payload = false): string {
    return JSON.stringify(value, (field, item: unknown) => {
      if (
        !payload &&
        item &&
        typeof item === 'object' &&
        ['headers', 'args', 'arguments', 'details', 'finalDiff', 'payload', 'body'].includes(field)
      )
        return JSON.parse(serialize(item, true));
      if (payload && item && typeof item === 'object' && !Array.isArray(item))
        return Object.fromEntries(
          Object.entries(item).map(([name, value]) => [privateText(name, secrets), value]),
        );
      if (typeof item !== 'string') return item;
      if (
        !payload &&
        ['type', 'role', 'stopReason', 'status', 'phase', 'reason', 'source'].includes(field) &&
        tags.has(item)
      )
        return item;
      return privateText(item, secrets);
    });
  }
  return JSON.parse(serialize(trace)) as AgentTrace;
}
