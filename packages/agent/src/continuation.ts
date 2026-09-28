import {
  type AgentMessage,
  BACKGROUND_CONTEXT,
  DEFAULT_COMPACTION_SETTINGS,
  type Entry,
  type JsonValue,
  type StreamFn,
  compact,
  createCompactionSummaryMessage,
  estimateContextTokens,
  estimateTokens,
  prepareCompaction,
  withAbortSignal,
} from '@earendil-works/pi-agent-core';
import {
  type AssistantMessage,
  type Models,
  type RetryCallbacks,
  type SimpleStreamOptions,
  createAssistantMessageEventStream,
  isContextOverflow,
  retryAssistantCall,
} from '@earendil-works/pi-ai';
import { builtInApiKeys } from './catalog.ts';
import type { AgentSessionEvent, AgentSessionOptions } from './types.ts';

function continuationSettings(options: AgentSessionOptions) {
  const retry = { enabled: true, maxRetries: 3, baseDelayMs: 2000, ...options.retry };
  const compaction = { ...DEFAULT_COMPACTION_SETTINGS, ...options.compaction };
  for (const [name, settings] of Object.entries({ retry, compaction })) {
    if (typeof settings.enabled !== 'boolean')
      throw new TypeError(`${name}.enabled must be boolean`);
    for (const [key, value] of Object.entries(settings)) {
      if (key === 'enabled') continue;
      if (!Number.isSafeInteger(value) || Number(value) < 0)
        throw new TypeError(`${name}.${key} must be a nonnegative safe integer`);
    }
  }
  return { retry, compaction };
}

function scrubText(text: string, secrets: readonly string[]): string {
  return secrets.reduce((result, secret) => result.replaceAll(secret, '[redacted]'), text);
}

class OverflowResponse {
  constructor(readonly response: AssistantMessage) {}
}

/** Native policy around each request; Agent remains the only message owner. */
export function createContinuation(
  options: AgentSessionOptions,
  selected: () => NonNullable<ReturnType<Models['getModel']>>,
  emit: (event: AgentSessionEvent) => void,
) {
  const settings = continuationSettings(options);
  const declared = options.secrets ?? [];
  if (!Array.isArray(declared) || declared.some((secret) => typeof secret !== 'string'))
    throw new TypeError('secrets must be an array of strings');
  const copied = [...declared];
  // Read per response so later-registered built-in providers count; longest first.
  // pi formats HTTP error bodies as `<status>: <JSON>`, so the escaped form is masked too.
  const secrets = () =>
    [
      ...new Set(
        [...builtInApiKeys(options.models), ...copied]
          .filter(Boolean)
          .flatMap((secret) => [secret, JSON.stringify(secret).slice(1, -1)]),
      ),
    ].sort((a, b) => b.length - a.length);
  const scrubbed = (text: string) => scrubText(text, secrets());
  // Provider ingress: every exit (history, status, retry, overflow, trace) sees this copy.
  // Streamed deltas stay raw; the final message replaces them and errors never stream.
  function scrub(message: AssistantMessage): AssistantMessage {
    const list = secrets();
    return {
      ...message,
      content: message.content.map((block) =>
        block.type === 'text'
          ? { ...block, text: scrubText(block.text, list) }
          : block.type === 'thinking'
            ? { ...block, thinking: scrubText(block.thinking, list) }
            : block,
      ),
      ...(message.errorMessage === undefined
        ? {}
        : { errorMessage: scrubText(message.errorMessage, list) }),
    };
  }
  const usage: { input: number; output: number; totalTokens: number } = {
    input: 0,
    output: 0,
    totalTokens: 0,
  };
  function account(message: AssistantMessage) {
    usage.input += message.usage.input;
    usage.output += message.usage.output;
    usage.totalTokens += message.usage.totalTokens;
  }
  function callbacks(
    source: 'assistant' | 'summary',
    response?: () => AssistantMessage | undefined,
  ): RetryCallbacks {
    return {
      onRetryScheduled: (attempt, maxAttempts, delayMs, errorMessage) =>
        emit({
          type: 'retry',
          phase: 'start',
          source,
          ...(response ? { message: response() } : {}),
          attempt,
          maxAttempts,
          delayMs,
          errorMessage: scrubbed(errorMessage),
        }),
      onRetryFinished: (success, attempt, errorMessage) =>
        emit({
          type: 'retry',
          phase: 'end',
          source,
          success,
          attempt,
          errorMessage: errorMessage === undefined ? undefined : scrubbed(errorMessage),
        }),
    };
  }
  function requestOptions(base: SimpleStreamOptions = {}): SimpleStreamOptions {
    const model = selected();
    const defaults = options.modelOptions?.[model.id];
    return { ...base, ...defaults, reasoning: defaults?.reasoning, maxRetries: 0 };
  }
  let cancelledBackoff = false;
  const stream: StreamFn = (_model, context, base) => {
    cancelledBackoff = false;
    let waitingForRetry = false;
    const output = createAssistantMessageEventStream();
    let started = false;
    let retryAttempt = 0;
    let response: AssistantMessage | undefined;
    const notices = callbacks('assistant', () => response);
    const completion = (async () => {
      let result: AssistantMessage;
      try {
        result = await retryAssistantCall(
          async () => {
            base?.signal?.throwIfAborted();
            const model = selected();
            const attempt = options.models.streamSimple(model, context, requestOptions(base));
            for await (const event of attempt) {
              if (event.type === 'done' || event.type === 'error') continue;
              if (event.type === 'start') {
                if (started) continue;
                started = true;
              }
              output.push(event);
            }
            response = scrub(await attempt.result());
            account(response);
            // Pi CLI checks context before the transient classifier (which matches "500").
            if (isContextOverflow(response, model.contextWindow))
              throw new OverflowResponse(response);
            return response;
          },
          settings.retry,
          base?.signal,
          {
            ...notices,
            onRetryAttemptStart: () => {
              waitingForRetry = false;
            },
            onRetryScheduled: (...args) => {
              waitingForRetry = true;
              retryAttempt = args[0];
              return notices.onRetryScheduled?.(...args);
            },
          },
        );
      } catch (error) {
        if (!(error instanceof OverflowResponse)) throw error;
        result = error.response;
        if (retryAttempt) notices.onRetryFinished?.(false, retryAttempt, result.errorMessage);
      }
      cancelledBackoff = waitingForRetry && result.stopReason === 'aborted';
      if (result.stopReason === 'error' || result.stopReason === 'aborted')
        output.push({ type: 'error', reason: result.stopReason, error: result });
      else if (result.stopReason !== 'pending')
        output.push({ type: 'done', reason: result.stopReason, message: result });
      else throw new Error('Provider completed with pending stopReason');
      return result;
    })();
    // Preserve a thrown provider exception for Agent's native failure normalization.
    output.result = () => completion;
    void completion.catch(() => output.end());
    return output;
  };

  async function compactMessages(
    messages: AgentMessage[],
    reason: 'threshold' | 'overflow',
    signal: AbortSignal,
  ) {
    if (!settings.compaction.enabled || signal.aborted) return undefined;
    const entries: Entry[] = messages.map((message, index) => {
      const base = {
        id: String(index),
        parentId: index ? String(index - 1) : null,
        seq: index,
        timestamp: message.timestamp,
      };
      if (message.role !== 'compactionSummary') return { ...base, type: 'message', message };
      return {
        ...base,
        type: 'compaction',
        summary: message.summary,
        tokensBefore: message.tokensBefore,
        retainedTail: [],
        fromHook: false,
        ...('details' in message ? { details: message.details as JsonValue } : {}),
      };
    });
    const preparation = prepareCompaction(entries, settings.compaction);
    if (!preparation.ok || !preparation.value) return undefined;
    // The CLI declines an empty summary/cut; core preparation alone permits it.
    if (
      (!preparation.value.messagesToSummarize.length &&
        !preparation.value.turnPrefixMessages.length) ||
      !preparation.value.retainedTail.length
    )
      return undefined;
    const source = estimateContextTokens(messages).lastUsageIndex === null ? 'estimate' : 'usage';
    // Core context entries filter failures; the CLI estimates the persisted journal.
    const before = estimateContextTokens(messages).tokens;
    emit({ type: 'compaction', phase: 'start', reason, tokensBefore: before, source });
    const scopedModels = new Proxy(options.models, {
      get(target, property) {
        if (property === 'completeSimple') {
          const complete: Models['completeSimple'] = async (_model, context, base) => {
            signal.throwIfAborted();
            const model = selected();
            const response = scrub(
              await target.completeSimple(model, context, {
                ...requestOptions(base),
                signal,
                maxTokens: Math.min(base?.maxTokens ?? model.maxTokens, model.maxTokens),
              }),
            );
            account(response);
            return response;
          };
          return complete;
        }
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    try {
      const result = await compact(
        { ...preparation.value, tokensBefore: before },
        scopedModels,
        selected(),
        undefined,
        options.modelOptions?.[selected().id]?.reasoning ?? 'off',
        settings.retry,
        callbacks('summary'),
        withAbortSignal(signal, BACKGROUND_CONTEXT),
      );
      if (!result.ok || signal.aborted) {
        emit({
          type: 'compaction',
          phase: 'end',
          reason,
          source,
          tokensBefore: before,
          success: false,
          aborted: signal.aborted,
          errorMessage: result.ok ? 'Aborted' : scrubbed(result.error.message),
        });
        return undefined;
      }
      const value = result.value;
      const summary = {
        ...createCompactionSummaryMessage(value.summary, value.tokensBefore, Date.now()),
        details: value.details,
      };
      const retained = [summary, ...value.retainedTail];
      emit({
        type: 'compaction',
        phase: 'end',
        reason,
        source,
        tokensBefore: before,
        tokensAfter: retained.reduce((total, message) => total + estimateTokens(message), 0),
        success: true,
        summary,
        retainedMessageCount: value.retainedTail.length,
        aborted: false,
        usage: value.usage,
      });
      return retained;
    } catch (error) {
      emit({
        type: 'compaction',
        phase: 'end',
        reason,
        source,
        tokensBefore: before,
        success: false,
        aborted: signal.aborted,
        errorMessage: scrubbed(error instanceof Error ? error.message : String(error)),
      });
      return undefined;
    }
  }
  return {
    ...settings,
    stream,
    get cancelledBackoff() {
      return cancelledBackoff;
    },
    compactMessages,
    usage,
    reset() {
      cancelledBackoff = false;
      usage.input = 0;
      usage.output = 0;
      usage.totalTokens = 0;
    },
  };
}
