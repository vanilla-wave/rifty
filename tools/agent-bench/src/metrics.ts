import { type AssistantMessage, isContextOverflow } from '@earendil-works/pi-ai';

export interface Metrics {
  inputTokens: number;
  outputTokens: number;
  retries: number;
  compactions: number;
  repeatedCallNotices: number;
  editFailures: number;
  malformedToolCalls: number;
  contextExceeded: boolean;
}
export function emptyMetrics(): Metrics {
  return {
    inputTokens: 0,
    outputTokens: 0,
    retries: 0,
    compactions: 0,
    repeatedCallNotices: 0,
    editFailures: 0,
    malformedToolCalls: 0,
    contextExceeded: false,
  };
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}
function number(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

/** Counts emitted observations, never guesses a mechanism from an outcome. */
export function eventMetrics(
  events: readonly unknown[],
  contextWindow: number,
  status: string,
): Metrics {
  const metrics = emptyMetrics();
  let lastAssistant: AssistantMessage | undefined;
  function usage(value: unknown) {
    const data = record(value);
    metrics.inputTokens += number(data?.input) + number(data?.cacheRead) + number(data?.cacheWrite);
    metrics.outputTokens += number(data?.output);
  }
  for (const raw of events) {
    const envelope = record(raw);
    const outer = record(envelope?.event) ?? envelope;
    const event = outer?.type === 'agent' ? record(outer.event) : outer;
    if (!event) continue;
    if (event.type === 'auto_retry_start' || (event.type === 'retry' && event.phase === 'start'))
      metrics.retries++;
    if (event.type === 'repeated-call') metrics.repeatedCallNotices++;
    const compaction =
      event.type === 'compaction_end'
        ? record(event.result)
        : event.type === 'compaction' && event.phase === 'end' && event.success === true
          ? event
          : undefined;
    if (compaction && event.aborted !== true) {
      metrics.compactions++;
      usage(compaction.usage);
    }
    if (event.type !== 'message_end') continue;
    const message = record(event.message);
    if (message?.role === 'assistant') {
      lastAssistant = message as unknown as AssistantMessage;
      usage(message.usage);
    }
    if (message?.role !== 'toolResult' || message.isError !== true) continue;
    if (['edit_file', 'apply_patch', 'edit'].includes(String(message.toolName)))
      metrics.editFailures++;
    const text = Array.isArray(message.content)
      ? message.content.map((part) => record(part)?.text ?? '').join('\n')
      : '';
    if (/Validation failed for tool |Tool .+ not found/.test(text)) metrics.malformedToolCalls++;
  }
  metrics.contextExceeded =
    status === 'context-exceeded' ||
    Boolean(lastAssistant && isContextOverflow(lastAssistant, contextWindow));
  return metrics;
}
