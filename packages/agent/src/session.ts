import { Agent, type AgentMessage } from '@earendil-works/pi-agent-core';
import type { Model, ToolResultMessage } from '@earendil-works/pi-ai';
import { streamSimple } from '@earendil-works/pi-ai/api/openai-completions';
import { PROMPT_PROFILE_ID, systemPrompt } from './prompt.ts';
import { isToolFailure, standardTools, wrapTool } from './tools.ts';
import type {
  AgentSession,
  AgentSessionEvent,
  AgentSessionOptions,
  AgentStatus,
  AgentTrace,
} from './types.ts';

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new TypeError(`${name} must be a positive safe integer`);
  return value;
}

function explainError(message: string): string {
  return /failed to fetch|fetch failed|networkerror|connection error/i.test(message)
    ? `${message}. Browser endpoint access failed; for CORS use the playground dev proxy (RIFTY_AI_PROXY_TARGET, Base URL /ai-proxy/v1).`
    : message;
}

export function createAgentSession(options: AgentSessionOptions): AgentSession {
  const { host, settings } = options;
  if (!settings.model.trim()) throw new TypeError('Agent model is required');
  const baseUrl = new URL(
    settings.baseUrl,
    typeof location === 'undefined' ? undefined : location.href,
  ).href;
  const maxToolCalls = positiveInteger(settings.maxToolCalls ?? 100, 'maxToolCalls');
  const runTimeoutMs = positiveInteger(settings.runTimeoutMs ?? 180_000, 'runTimeoutMs');
  const model: Model<'openai-completions'> = {
    id: settings.model,
    name: settings.model,
    api: 'openai-completions',
    provider: 'rifty',
    baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8192,
  };
  const listeners = new Set<(event: AgentSessionEvent) => void>();
  const events: { at: number; event: AgentSessionEvent }[] = [];
  const timings: { startedAt: number; endedAt: number }[] = [];
  let status: AgentStatus = 'idle';
  let detail: string | undefined;
  let active: Promise<void> | undefined;
  let disposed = false;
  let stopRequested = false;
  let budgetReason: string | undefined;
  let toolCalls = 0;
  let runEventStart = 0;

  function emit(event: AgentSessionEvent): void {
    events.push({ at: Date.now(), event: structuredClone(event) });
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('Agent event listener failed', error);
      }
    }
  }
  function setStatus(value: AgentStatus, reason?: string): void {
    status = value;
    detail = reason;
    emit({ type: 'status', status, ...(reason === undefined ? {} : { detail: reason }) });
  }

  function refreshCapabilities() {
    const capabilities = host.capabilities();
    const tools = [...standardTools(host.root, capabilities, emit), ...(options.tools ?? [])];
    const names = tools.map((tool) => tool.name);
    if (new Set(names).size !== names.length)
      throw new TypeError('Agent tool names must be unique');
    emit({ type: 'capabilities', tools: names, notes: capabilities.notes ?? [] });
    return {
      systemPrompt: systemPrompt(host.root, tools, capabilities, options.instructions ?? []),
      tools: tools.map(wrapTool),
    };
  }

  const agent = new Agent({
    initialState: { model, ...refreshCapabilities() },
    toolExecution: 'sequential',
    streamFn:
      options.streamFn ??
      ((selected, context, requestOptions) => {
        if (selected.api !== 'openai-completions')
          throw new TypeError('Default transport requires openai-completions');
        return streamSimple(selected as Model<'openai-completions'>, context, {
          ...requestOptions,
          apiKey: settings.apiKey || 'unused-no-auth-sentinel',
          ...(settings.apiKey ? {} : { headers: { Authorization: null } }),
          ...(options.fetch ? { fetch: options.fetch } : {}),
          maxRetries: 0,
        });
      }),
    prepareNextTurnWithContext: (context) => {
      const refreshed = refreshCapabilities();
      agent.state.systemPrompt = refreshed.systemPrompt;
      agent.state.tools = refreshed.tools;
      return { context: { ...context.context, ...refreshed } };
    },
    beforeToolCall: async () => {
      if (toolCalls < maxToolCalls && budgetReason === undefined) {
        toolCalls++;
        return;
      }
      budgetReason ??= `Maximum tool calls reached (${maxToolCalls})`;
      agent.abort();
      return { block: true, reason: budgetReason, terminate: true };
    },
    afterToolCall: async (context) => {
      if (isToolFailure(context.result)) return { isError: true };
    },
  });
  const detach = agent.subscribe((event) => {
    if (event.type === 'agent_start' && stopRequested) agent.abort();
    if (event.type === 'agent_end') {
      const count = event.messages.length + completeSkippedCalls();
      emit({
        type: 'agent',
        event: { ...event, messages: count ? agent.state.messages.slice(-count) : [] },
      });
      return;
    }
    emit({ type: 'agent', event });
  });

  function completeSkippedCalls(): number {
    let added = 0;
    const messages: AgentMessage[] = [];
    const original = agent.state.messages;
    for (let index = 0; index < original.length; index++) {
      const message = original[index];
      if (!message) continue;
      messages.push(message);
      // Interrupted proposals never entered tool dispatch. Pi omits them on wire;
      // adding a result would create an orphaned tool response.
      if (
        message.role !== 'assistant' ||
        message.stopReason === 'aborted' ||
        message.stopReason === 'error'
      )
        continue;
      const calls = message.content.filter((block) => block.type === 'toolCall');
      if (!calls.length) continue;
      const results: ToolResultMessage[] = [];
      let next = index + 1;
      while (original[next]?.role === 'toolResult') {
        const result = original[next] as ToolResultMessage;
        results.push(result);
        messages.push(result);
        next++;
      }
      for (const call of calls) {
        if (results.some((result) => result.toolCallId === call.id)) continue;
        const started = events
          .slice(runEventStart)
          .some(
            ({ event }) =>
              event.type === 'agent' &&
              event.event.type === 'tool_execution_start' &&
              event.event.toolCallId === call.id,
          );
        const result: ToolResultMessage = {
          role: 'toolResult',
          toolCallId: call.id,
          toolName: call.name,
          isError: true,
          timestamp: Date.now(),
          content: [
            {
              type: 'text',
              text: started
                ? 'Tool outcome unknown after interrupted settlement; inspect host state before another action.'
                : 'Not executed: run ended before this tool call.',
            },
          ],
          details: { status: 'cancelled', applied: started ? 'unknown' : 'no' },
        };
        messages.push(result);
        added++;
        emit({ type: 'agent', event: { type: 'message_end', message: result } });
        emit({
          type: 'agent',
          event: {
            type: 'tool_execution_end',
            toolCallId: call.id,
            toolName: call.name,
            result: { content: result.content, details: result.details },
            isError: true,
          },
        });
      }
      index = next - 1;
    }
    agent.state.messages = messages;
    return added;
  }

  async function run(prompt: string): Promise<void> {
    const startedAt = Date.now();
    let outcome: AgentStatus;
    let outcomeDetail: string | undefined;
    const timer = setTimeout(() => {
      budgetReason = `Run time limit reached (${runTimeoutMs}ms)`;
      agent.abort();
    }, runTimeoutMs);
    try {
      if (!stopRequested) {
        const refreshed = refreshCapabilities();
        agent.state.systemPrompt = refreshed.systemPrompt;
        agent.state.tools = refreshed.tools;
        await agent.prompt(prompt);
      }
      if (budgetReason) {
        outcome = 'budget-exceeded';
        outcomeDetail = budgetReason;
      } else if (stopRequested) outcome = 'aborted';
      else if (agent.state.errorMessage) {
        outcome = 'error';
        outcomeDetail = explainError(agent.state.errorMessage);
      } else outcome = 'done';
    } catch (error) {
      outcome = budgetReason ? 'budget-exceeded' : stopRequested ? 'aborted' : 'error';
      outcomeDetail = explainError(error instanceof Error ? error.message : String(error));
    } finally {
      clearTimeout(timer);
      timings.push({ startedAt, endedAt: Date.now() });
    }
    setStatus(outcome, outcomeDetail);
  }

  return {
    status: () => status,
    detail: () => detail,
    async send(prompt) {
      if (disposed) throw new Error('Agent session is disposed');
      if (active) throw new Error('Agent run already in progress');
      if (!prompt.trim()) throw new TypeError('Agent prompt is empty');
      stopRequested = false;
      budgetReason = undefined;
      toolCalls = 0;
      runEventStart = events.length;
      active = Promise.resolve().then(() => run(prompt));
      setStatus('running');
      try {
        await active;
      } finally {
        active = undefined;
      }
    },
    async stop() {
      stopRequested = true;
      agent.abort();
      await active;
    },
    reset() {
      if (active) throw new Error('Stop the agent before Reset');
      if (disposed) throw new Error('Agent session is disposed');
      agent.reset();
      events.length = 0;
      timings.length = 0;
      budgetReason = undefined;
      setStatus('idle');
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async exportTrace(): Promise<AgentTrace> {
      const usage = { input: 0, output: 0, totalTokens: 0 };
      for (const message of agent.state.messages) {
        if (message.role !== 'assistant') continue;
        usage.input += message.usage.input;
        usage.output += message.usage.output;
        usage.totalTokens += message.usage.totalTokens;
      }
      const diff = host.capabilities().diff;
      let finalDiff: unknown = { unavailable: 'Host does not provide SCM diff' };
      if (diff) {
        try {
          finalDiff = await diff();
        } catch (error) {
          finalDiff = { error: error instanceof Error ? error.message : String(error) };
        }
      }
      const trace: AgentTrace = {
        version: 1,
        profile: PROMPT_PROFILE_ID,
        config: { baseUrl: settings.baseUrl, model: settings.model, maxToolCalls, runTimeoutMs },
        transcript: agent.state.messages,
        events,
        timings,
        status,
        usage,
        finalDiff,
      };
      const serialized = JSON.stringify(trace, (_key, value: unknown) =>
        typeof value === 'string' && settings.apiKey
          ? value.split(settings.apiKey).join('[redacted]')
          : value,
      );
      return JSON.parse(serialized) as AgentTrace;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      stopRequested = true;
      agent.abort();
      await active;
      detach();
      listeners.clear();
      await host.close();
    },
  };
}
