/**
 * AI session: the Pi agent loop wired to rifty tools (ADR-0190). Provider
 * access goes ONLY through the `pi-ai/api/openai-completions` subpath — one
 * streaming chat-completions contract against the user-configured endpoint.
 * Per-run budgets (max tool calls, wall clock) end a run in a DISTINCT
 * `budget-exceeded` state; stream failures surface as `error` with a
 * user-readable message (naming the dev CORS proxy when the fetch itself
 * failed); Stop aborts; done = final assistant message without tool calls.
 */
import { Agent, type AgentEvent, type StreamFn } from '@earendil-works/pi-agent-core';
import type { Model } from '@earendil-works/pi-ai';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import type { AiAppContext } from './app-context.ts';
import { createRunBudget } from './budget.ts';
import { buildSystemPrompt } from './prompt-profile.ts';
import { type AiSettings, aiConfigSnapshot, resolveBaseUrl } from './settings.ts';
import { buildAgentTools } from './tools/index.ts';
import { type AiRunStatus, type AiSessionTrace, AiTraceRecorder } from './trace.ts';

export type { AiRunStatus } from './trace.ts';

export type AiSessionEvent =
  | { readonly type: 'agent'; readonly event: AgentEvent }
  | { readonly type: 'status'; readonly status: AiRunStatus; readonly detail: string | null };

export interface AiSession {
  status(): AiRunStatus;
  statusDetail(): string | null;
  /** Run one user prompt to completion (resolves when the run settles). */
  send(text: string): Promise<void>;
  /** Abort the in-flight run (Stop button). */
  stop(): void;
  subscribe(listener: (event: AiSessionEvent) => void): () => void;
  /** The full session trace incl. the final git diff — never the apiKey. */
  exportTrace(): Promise<AiSessionTrace>;
  dispose(): void;
}

/**
 * Make a stream failure user-readable. A browser-side fetch failure
 * (typically CORS) names the dev-proxy escape hatch explicitly — never a
 * silent hang (backlog item: out-of-scope providers fail loud).
 */
export function explainRunError(errorMessage: string, baseUrl: string): string {
  const networkLike =
    /failed to fetch|fetch failed|network\s?error|load failed|connection error/i.test(errorMessage);
  if (!networkLike) return errorMessage;
  return `${errorMessage} — the endpoint at ${baseUrl} was unreachable from the browser. If the provider blocks cross-origin (CORS) requests, use the dev proxy: start the playground with RIFTY_AI_PROXY_TARGET=<provider origin> and set Base URL to /ai-proxy/v1.`;
}

/** Build the Pi model object for an OpenAI-compatible endpoint (ADR-0190). */
export function modelFromSettings(
  settings: AiSettings,
  origin: string,
): Model<'openai-completions'> {
  return {
    id: settings.model,
    name: settings.model,
    api: 'openai-completions',
    provider: 'custom',
    baseUrl: resolveBaseUrl(settings.baseUrl, origin),
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: settings.contextWindow ?? 128_000,
    maxTokens: 8_192,
  };
}

export function createAiSession(options: {
  readonly ctx: AiAppContext;
  readonly settings: AiSettings;
  readonly origin: string;
}): AiSession {
  const { ctx, settings, origin } = options;
  if (settings.model.trim() === '') {
    throw new Error('AI settings: model is empty — configure it in Settings');
  }
  const model = modelFromSettings(settings, origin);
  const toolSet = buildAgentTools(ctx);
  const recorder = new AiTraceRecorder(aiConfigSnapshot(settings));
  const budget = createRunBudget({
    maxToolCalls: settings.maxToolCalls,
    runTimeoutMs: settings.runTimeoutMs,
  });
  const listeners = new Set<(event: AiSessionEvent) => void>();
  let status: AiRunStatus = 'idle';
  let statusDetail: string | null = null;
  let disposed = false;

  function emit(event: AiSessionEvent): void {
    for (const listener of listeners) listener(event);
  }

  function setStatus(next: AiRunStatus, detail: string | null = null): void {
    // budget-exceeded is sticky for the run: the abort that enforces it must
    // not downgrade the outcome to 'aborted'.
    if (status === 'budget-exceeded' && (next === 'aborted' || next === 'error')) return;
    status = next;
    statusDetail = detail;
    recorder.setStatus(next);
    emit({ type: 'status', status: next, detail });
  }

  const agent = new Agent({
    initialState: {
      systemPrompt: buildSystemPrompt({ cwd: ctx.root(), tools: toolSet.summaries }),
      model,
      tools: toolSet.tools,
    },
    // Our model is always api:'openai-completions', so the subpath streamer is
    // the exact contract; the cast erases its narrower (sound at runtime) model
    // parameter to Pi's provider-generic StreamFn signature.
    streamFn: streamSimple as unknown as StreamFn,
    getApiKey: () => settings.apiKey,
    // Keep the shell honest: one tool at a time (the agent terminal session is
    // a single serialized pty; parallel writes would interleave).
    toolExecution: 'sequential',
    beforeToolCall: (_context) => {
      const reason = budget.beforeToolCall();
      if (reason === null) return Promise.resolve(undefined);
      recorder.markBudgetExceeded(reason);
      setStatus('budget-exceeded', reason);
      // Abort after this hook returns so the blocked-call bookkeeping finishes.
      queueMicrotask(() => agent.abort());
      return Promise.resolve({ block: true, reason });
    },
  });

  const unsubscribeAgent = agent.subscribe((event) => {
    recorder.onEvent(event);
    emit({ type: 'agent', event });
  });

  function settleStatus(): void {
    const budgetReason = budget.exceededReason();
    if (budgetReason !== null) {
      recorder.markBudgetExceeded(budgetReason);
      setStatus('budget-exceeded', budgetReason);
      return;
    }
    const lastAssistant = [...agent.state.messages]
      .reverse()
      .find(
        (message): message is Extract<typeof message, { role: 'assistant' }> =>
          'role' in message && message.role === 'assistant',
      );
    if (lastAssistant?.stopReason === 'aborted') {
      setStatus('aborted');
      return;
    }
    if (lastAssistant?.stopReason === 'error' || agent.state.errorMessage) {
      const raw = lastAssistant?.errorMessage ?? agent.state.errorMessage ?? 'run failed';
      setStatus('error', explainRunError(raw, model.baseUrl));
      return;
    }
    setStatus('done');
  }

  return {
    status: () => status,
    statusDetail: () => statusDetail,
    async send(text: string): Promise<void> {
      if (disposed) throw new Error('AI session is disposed');
      if (status === 'running') throw new Error('a run is already in progress');
      budget.startRun();
      setStatus('running');
      // Wall-clock budget also without tool calls (a hung stream must still
      // end as budget-exceeded, not hang forever).
      const timer = setTimeout(() => {
        const reason = budget.timeExceeded();
        if (reason !== null) {
          recorder.markBudgetExceeded(reason);
          setStatus('budget-exceeded', reason);
          agent.abort();
        }
      }, settings.runTimeoutMs);
      try {
        await agent.prompt(text);
      } catch (err) {
        setStatus('error', explainRunError((err as Error).message, model.baseUrl));
        return;
      } finally {
        clearTimeout(timer);
      }
      settleStatus();
    },
    stop(): void {
      agent.abort();
    },
    subscribe(listener: (event: AiSessionEvent) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async exportTrace(): Promise<AiSessionTrace> {
      let finalDiff: AiSessionTrace['finalDiff'];
      try {
        finalDiff = await ctx.gitDiff();
      } catch (err) {
        finalDiff = { error: (err as Error).message };
      }
      return recorder.snapshot(finalDiff);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribeAgent();
      listeners.clear();
      agent.abort();
    },
  };
}
