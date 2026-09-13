import type { AgentTrace } from '@riftydev/agent';
import type { Observation } from './types.ts';
export function coreObservation(trace: AgentTrace, requests: unknown[]): Observation {
  const tools = trace.transcript.filter((message) => message.role === 'toolResult');
  return {
    agentStatus: trace.status,
    turns: trace.transcript.filter((message) => message.role === 'assistant').length,
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
