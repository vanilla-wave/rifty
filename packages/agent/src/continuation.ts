import type { StreamFn } from '@earendil-works/pi-agent-core';
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
import {
  type CompactionResult,
  DEFAULT_COMPACTION_SETTINGS,
  type Entry,
  buildProjection,
  compact,
  estimateProjectedContextTokens,
  prepareCompaction,
} from './pi-cli/compaction.ts';
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
  const scrubbed = (text: string) =>
    secrets().reduce((result, secret) => result.replaceAll(secret, '[redacted]'), text);
  // Provider ingress, error text only: every exit (history, status, retry, overflow, trace)
  // sees this copy. Content stays raw: the model reads it back, a short key would corrupt it.
  function scrub(message: AssistantMessage): AssistantMessage {
    return message.errorMessage === undefined
      ? message
      : { ...message, errorMessage: scrubbed(message.errorMessage) };
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
  // Retry errorMessage is the already-scrubbed response's (pi retryAssistantCall).
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
          errorMessage,
        }),
      onRetryFinished: (success, attempt, errorMessage) =>
        emit({ type: 'retry', phase: 'end', source, success, attempt, errorMessage }),
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
        if (!(error instanceof OverflowResponse)) {
          if (error instanceof Error) {
            const message = scrubbed(error.message);
            // Same object for Agent's normalization; defineProperty covers DOMException's getter.
            if (message !== error.message)
              Object.defineProperty(error, 'message', { value: message });
          }
          throw error;
        }
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

  /** CLI `_runAutoCompaction` over rifty's journal; the caller installs the result. */
  async function compactJournal(
    path: Entry[],
    reason: 'threshold' | 'overflow',
    signal: AbortSignal,
  ): Promise<(CompactionResult & { source: 'usage' | 'estimate' }) | undefined> {
    if (!settings.compaction.enabled || signal.aborted) return undefined;
    const preparation = prepareCompaction(path, settings.compaction);
    if (!preparation) return undefined;
    const before = preparation.tokensBefore;
    const source =
      estimateProjectedContextTokens(buildProjection(path), path).lastUsageIndex === null
        ? 'estimate'
        : 'usage';
    emit({ type: 'compaction', phase: 'start', reason, tokensBefore: before, source });
    const fail = (error: unknown) => {
      emit({
        type: 'compaction',
        phase: 'end',
        reason,
        source,
        tokensBefore: before,
        success: false,
        aborted: signal.aborted,
        errorMessage: signal.aborted
          ? 'Aborted'
          : scrubbed(error instanceof Error ? error.message : String(error)),
      });
      return undefined;
    };
    try {
      const model = selected();
      const result = await compact(preparation, {
        complete: async (context, base) => {
          signal.throwIfAborted();
          const response = scrub(
            await options.models.completeSimple(selected(), context, {
              ...requestOptions(base),
              signal,
            }),
          );
          account(response);
          return response;
        },
        reasoning: model.reasoning,
        thinkingLevel: options.modelOptions?.[model.id]?.reasoning ?? 'off',
        signal,
        retry: settings.retry,
        callbacks: callbacks('summary'),
      });
      return signal.aborted ? fail(undefined) : { ...result, source };
    } catch (error) {
      return fail(error);
    }
  }
  return {
    ...settings,
    stream,
    get cancelledBackoff() {
      return cancelledBackoff;
    },
    compactJournal,
    usage,
    reset() {
      cancelledBackoff = false;
      usage.input = 0;
      usage.output = 0;
      usage.totalTokens = 0;
    },
  };
}
