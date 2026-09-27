import { Agent, type AgentMessage } from '@earendil-works/pi-agent-core';
import type { ImageContent, ToolResultMessage } from '@earendil-works/pi-ai';
import { NotImplementedError } from '@riftydev/io';
import { catalogSecrets, isOpenAIProvider, selectModel } from './catalog.ts';
import { unsupportedChatCommand } from './chat-command.ts';
import { restoreMessages } from './history.ts';
import { PROMPT_PROFILE_ID, systemPrompt } from './prompt.ts';
import { loadResources } from './resources.ts';
import { isToolFailure, standardTools, wrapTool } from './tools.ts';
import { redactTrace } from './trace.ts';
import type {
  AgentResourceReport,
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

export function createAgentSession(options: AgentSessionOptions): AgentSession {
  const { host } = options;
  if (!options.models || 'settings' in options || 'streamFn' in options || 'fetch' in options)
    throw new TypeError(
      'Agent requires a model catalog (models and model); legacy transports are removed',
    );
  let model = selectModel(options.models, options.model);
  const requestDefaults = () => options.modelOptions?.[model.id] ?? {};
  const secrets = new Set(catalogSecrets(options.models));
  const maxToolCalls = positiveInteger(options.maxToolCalls ?? 100, 'maxToolCalls');
  const runTimeoutMs = positiveInteger(options.runTimeoutMs ?? 180_000, 'runTimeoutMs');
  const initialMessages = restoreMessages(options.initialMessages);
  let restoredMessageCount = initialMessages.length;
  const listeners = new Set<(event: AgentSessionEvent) => void>();
  const events: { at: number; event: AgentSessionEvent }[] = [];
  const timings: { startedAt: number; endedAt: number }[] = [];
  let resources: AgentResourceReport | undefined;
  // Latest admitted read: send and dispose settle on it; reload chains after it.
  let pending: Promise<AgentResourceReport>;
  let reloading: Promise<AgentResourceReport> | undefined;
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

  async function readResources(): Promise<AgentResourceReport> {
    const report = await loadResources(host.root, host.capabilities(), options);
    resources = report;
    emit({ type: 'resources', report: structuredClone(report) });
    return structuredClone(report);
  }
  pending = readResources();
  // The next send observes a failed read and reload retries it; no unhandled
  // rejection if the consumer creates a session before subscribing/sending.
  void pending.catch(() => {});

  function refreshCapabilities() {
    const capabilities = host.capabilities();
    const tools = [...standardTools(host.root, capabilities, emit), ...(options.tools ?? [])];
    const names = tools.map((tool) => tool.name);
    if (new Set(names).size !== names.length)
      throw new TypeError('Agent tool names must be unique');
    emit({ type: 'capabilities', tools: names, notes: capabilities.notes ?? [] });
    return {
      systemPrompt: systemPrompt(
        host.root,
        tools,
        capabilities,
        options.instructions ?? [],
        resources,
      ),
      tools: tools.map(wrapTool),
    };
  }

  const agent = new Agent({
    initialState: {
      model,
      thinkingLevel: requestDefaults().reasoning ?? 'off',
      ...refreshCapabilities(),
      messages: initialMessages,
    },
    toolExecution: 'sequential',
    streamFn: (selected, context, requestOptions) =>
      options.models.streamSimple(selected, context, {
        ...requestOptions,
        ...(options.modelOptions?.[selected.id] ?? {}),
        maxRetries: 0,
      }),
    prepareNextTurnWithContext: (context) => {
      const refreshed = refreshCapabilities();
      agent.state.systemPrompt = refreshed.systemPrompt;
      agent.state.tools = refreshed.tools;
      return {
        model,
        thinkingLevel: requestDefaults().reasoning ?? 'off',
        context: { ...context.context, ...refreshed },
      };
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

  function checkImages(images: unknown): asserts images is readonly ImageContent[] | undefined {
    if (images === undefined) return;
    if (
      !Array.isArray(images) ||
      images.some(
        (image) =>
          !image ||
          image.type !== 'image' ||
          typeof image.mimeType !== 'string' ||
          !image.mimeType.startsWith('image/'),
      )
    )
      throw new NotImplementedError('agent.prompt-binary-input');
    if (images.some((image) => typeof image.data !== 'string' || !image.data))
      throw new TypeError('Image data must be a nonempty base64 string');
    if (images.length && !model.input.includes('image'))
      throw new TypeError(`Model ${model.id} does not accept images`);
  }

  async function run(prompt: string, images?: readonly ImageContent[]): Promise<void> {
    const startedAt = Date.now();
    let outcome: AgentStatus;
    let outcomeDetail: string | undefined;
    const timer = setTimeout(() => {
      budgetReason = `Run time limit reached (${runTimeoutMs}ms)`;
      agent.abort();
    }, runTimeoutMs);
    try {
      await pending;
      if (!stopRequested && budgetReason === undefined) {
        const command = unsupportedChatCommand(prompt, resources);
        if (command !== undefined)
          throw new NotImplementedError(
            'agent.commandExpansion',
            `Unsupported chat command ${command}: pi skill and prompt-template expansion is not supported.`,
          );
        const refreshed = refreshCapabilities();
        agent.state.systemPrompt = refreshed.systemPrompt;
        agent.state.tools = refreshed.tools;
        checkImages(images);
        await agent.prompt(prompt, images ? [...images] : undefined);
      }
      if (budgetReason) {
        outcome = 'budget-exceeded';
        outcomeDetail = budgetReason;
      } else if (stopRequested) outcome = 'aborted';
      else if (agent.state.errorMessage) {
        outcome = 'error';
        outcomeDetail = agent.state.errorMessage;
      } else outcome = 'done';
    } catch (error) {
      outcome = budgetReason ? 'budget-exceeded' : stopRequested ? 'aborted' : 'error';
      outcomeDetail = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timer);
      timings.push({ startedAt, endedAt: Date.now() });
    }
    setStatus(outcome, outcomeDetail);
  }

  return {
    setModel(id) {
      if (disposed) throw new Error('Agent session is disposed');
      const selected = selectModel(options.models, id);
      model = selected;
      agent.state.model = model;
      agent.state.thinkingLevel = requestDefaults().reasoning ?? 'off';
      for (const secret of catalogSecrets(options.models)) secrets.add(secret);
      emit({ type: 'model', model: model.id, provider: model.provider });
    },
    status: () => status,
    detail: () => detail,
    async send(prompt, images) {
      if (disposed) throw new Error('Agent session is disposed');
      if (active) throw new Error('Agent run already in progress');
      checkImages(images);
      if (!prompt.trim() && !images?.length) throw new TypeError('Agent prompt is empty');
      stopRequested = false;
      budgetReason = undefined;
      toolCalls = 0;
      runEventStart = events.length;
      const copiedImages = images ? structuredClone(images) : undefined;
      active = Promise.resolve().then(() => run(prompt, copiedImages));
      setStatus('running');
      try {
        await active;
      } finally {
        active = undefined;
      }
    },
    async reload() {
      if (disposed) throw new Error('Agent session is disposed');
      if (active) throw new Error('Stop the agent before Reload');
      if (reloading) throw new Error('Agent resource reload already in progress');
      reloading = pending.catch(() => undefined).then(readResources);
      pending = reloading;
      try {
        return await reloading;
      } finally {
        reloading = undefined;
      }
    },
    async stop() {
      stopRequested = true;
      agent.abort();
      await active;
    },
    reset() {
      if (active || reloading) throw new Error('Stop the agent before Reset');
      if (disposed) throw new Error('Agent session is disposed');
      agent.reset();
      restoredMessageCount = 0;
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
      for (const message of agent.state.messages.slice(restoredMessageCount)) {
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
      const { id: _id, headers: _headers, ...modelConfig } = model;
      const trace: AgentTrace = {
        version: 1,
        profile: PROMPT_PROFILE_ID,
        config: {
          ...modelConfig,
          model: model.id,
          transport: isOpenAIProvider(options.models.getProvider(model.provider))
            ? 'openai-compatible'
            : 'custom',
          thinking: requestDefaults().reasoning ?? 'off',
          ...(requestDefaults().temperature === undefined
            ? {}
            : { temperature: requestDefaults().temperature }),
          samplingParams: { ...model.samplingParams, ...requestDefaults().samplingParams },
          maxToolCalls,
          runTimeoutMs,
        },
        transcript: agent.state.messages,
        restoredMessageCount,
        events,
        timings,
        status,
        usage,
        finalDiff,
      };
      return redactTrace(trace, secrets);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      stopRequested = true;
      agent.abort();
      await active;
      await pending.catch(() => {});
      detach();
      listeners.clear();
      await host.close();
    },
  };
}
