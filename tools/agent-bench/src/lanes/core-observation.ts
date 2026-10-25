import type { AgentSessionEvent, AgentTrace } from '@riftydev/agent';
import { eventMetrics } from '../metrics.ts';
import type { Observation } from './types.ts';
export function coreObservation(
  trace: AgentTrace,
  requests: unknown[],
  events: readonly AgentSessionEvent[],
): Observation {
  const messages = events.flatMap((event) =>
    event.type === 'agent' && event.event.type === 'message_end' ? [event.event.message] : [],
  );
  const tools = messages.filter((message) => message.role === 'toolResult');
  return {
    ...eventMetrics(events, trace.config.contextWindow, trace.status),
    inputTokens: trace.usage.totalTokens - trace.usage.output,
    outputTokens: trace.usage.output,
    agentStatus: trace.status,
    turns: messages.filter((message) => message.role === 'assistant').length,
    // Pi emits an error result when admission aborts; core skipped proposals carry applied:no.
    // Count dispatched results, never the blocked proposal or unexecuted tail.
    toolCalls: tools.filter((message) => {
      const details = message.details as { applied?: string } | undefined;
      if (details?.applied === 'no') return false;
      return !(
        message.isError &&
        message.content.length === 1 &&
        message.content[0]?.type === 'text' &&
        message.content[0].text === 'Operation aborted'
      );
    }).length,
    usage: trace.usage,
    trace: { ...trace, providerRequests: requests },
    terminalTail: trace.events
      .filter(({ event }) => event.type === 'output')
      .map(({ event }) => (event.type === 'output' ? event.chunk : ''))
      .join('')
      .slice(-16000),
  };
}
