import {
  Agent,
  type AgentMessage,
  type AgentToolResult,
  convertToLlm,
  estimateContextTokens,
  shouldCompact,
} from '@earendil-works/pi-agent-core';
import {
  type AssistantMessage,
  type ImageContent,
  type ToolResultMessage,
  isContextOverflow,
} from '@earendil-works/pi-ai';
import { NotImplementedError } from '@riftydev/io';
import { isOpenAIProvider, selectModel } from './catalog.ts';
import { unsupportedChatCommand } from './chat-command.ts';
import { createContinuation } from './continuation.ts';
import { restoreMessages } from './history.ts';
import { PROMPT_PROFILE_ID, systemPrompt } from './prompt.ts';
import { loadResources } from './resources.ts';
import { capToolText } from './text.ts';
import { canonical, toolReceipt } from './tool-feedback.ts';
import { isToolFailure, standardTools, wrapTool } from './tools.ts';
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
  const maxToolCalls = positiveInteger(options.maxToolCalls ?? 100, 'maxToolCalls');
  const runTimeoutMs = positiveInteger(options.runTimeoutMs ?? 600_000, 'runTimeoutMs');
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
  let deadline = 0;
  let ownedTools = new Set<string>();
  let currentArgs: unknown;
  let previousCall: string | undefined;
  let repeatedCalls = 0;
  function finalizeTool(
    name: string,
    result: AgentToolResult<unknown>,
    isError: boolean,
    args: unknown,
  ) {
    const body = toolReceipt(
      result,
      name,
      ownedTools.has(name),
      isError,
      {
        callsLeft: Math.max(0, maxToolCalls - toolCalls),
        msLeft: Math.max(0, Math.min(runTimeoutMs, deadline - Date.now())),
      },
      { maxToolCalls, runTimeoutMs },
    );
    const signature = canonical([name, args, isError, body]);
    repeatedCalls = signature === previousCall ? repeatedCalls + 1 : 1;
    previousCall = signature;
    if (repeatedCalls === 3) {
      const message = `[Agent notice] Repeated tool call: ${name} returned the same result three times. Arguments (data): ${capToolText(canonical(args), 512)}. Result (data): ${JSON.stringify(capToolText(body, 2048))}. Inspect the feedback and change approach when appropriate.`;
      agent.steer({ role: 'user', content: message, timestamp: Date.now() });
      emit({ type: 'repeated-call', toolName: name, count: 3, message });
    }
  }

  let runController: AbortController | undefined;
  let overflowRecoveryAttempted = false;
  const continuation = createContinuation(options, () => model, emit);

  // Reconstruct Pi's persisted compaction input from the existing audit receipts.
  // Failed attempts remain here even when Agent drops them from request context.
  function compactionHistory(): AgentMessage[] {
    let messages = restoredMessageCount ? [...initialMessages] : [];
    for (const { event } of events) {
      if (event.type === 'agent' && event.event.type === 'message_end')
        messages.push(event.event.message);
      else if (
        event.type === 'retry' &&
        event.phase === 'start' &&
        event.source === 'assistant' &&
        event.message
      )
        messages.push(event.message);
      else if (
        event.type === 'compaction' &&
        event.phase === 'end' &&
        event.success &&
        event.summary &&
        event.retainedMessageCount !== undefined
      ) {
        messages = [
          event.summary,
          ...(event.retainedMessageCount ? messages.slice(-event.retainedMessageCount) : []),
        ];
      }
    }
    return messages;
  }

  async function compactHistory(
    reason: 'threshold' | 'overflow',
    staleGuard = false,
    overflowResponse?: AssistantMessage,
  ) {
    const messages = agent.state.messages;
    const estimate = estimateContextTokens(messages);
    if (reason === 'threshold') {
      const summary = messages[0];
      const source =
        estimate.lastUsageIndex === null ? undefined : messages[estimate.lastUsageIndex];
      if (
        staleGuard &&
        summary?.role === 'compactionSummary' &&
        source &&
        source.timestamp <= summary.timestamp
      )
        return false;
      if (!shouldCompact(estimate.tokens, model.contextWindow, continuation.compaction))
        return false;
    }
    if (!runController) return false;
    const retained = await continuation.compactMessages(
      compactionHistory(),
      reason,
      runController.signal,
    );
    if (!retained) return false;
    // Native CLI prepares from its persisted overflow entry, then removes it again before continue.
    const last = retained.at(-1);
    agent.state.messages =
      overflowResponse &&
      last?.role === 'assistant' &&
      (last.stopReason === 'error' || last.stopReason === 'length')
        ? retained.slice(0, -1)
        : retained;
    return true;
  }

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
    const standard = standardTools(host.root, capabilities, emit);
    ownedTools = new Set(standard.map((tool) => tool.name));
    const tools = [...standard, ...(options.tools ?? [])];
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
        options.recipe !== false,
      ),
      tools: tools.map((tool) => wrapTool(tool, false)),
    };
  }

  const agent: Agent = new Agent({
    initialState: {
      model,
      thinkingLevel: requestDefaults().reasoning ?? 'off',
      ...refreshCapabilities(),
      messages: initialMessages,
    },
    toolExecution: 'sequential',
    convertToLlm,
    streamFn: continuation.stream,
    prepareNextTurnWithContext: async (context) => {
      await compactHistory('threshold');
      const refreshed = refreshCapabilities();
      agent.state.systemPrompt = refreshed.systemPrompt;
      agent.state.tools = refreshed.tools;
      return {
        model,
        thinkingLevel: requestDefaults().reasoning ?? 'off',
        context: { ...context.context, ...refreshed, messages: agent.state.messages.slice() },
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
    if (event.type === 'tool_execution_start') currentArgs = structuredClone(event.args);
    if (event.type === 'tool_execution_end')
      finalizeTool(event.toolName, event.result, event.isError, currentArgs);

    // retryAssistantCall synthesizes an aborted response when sleep is cancelled;
    // the CLI keeps only the discarded attempt receipt, not that synthetic message.
    if (continuation.cancelledBackoff) {
      if (event.type === 'message_end' && event.message.role === 'assistant') {
        agent.state.messages = agent.state.messages.slice(0, -1);
        return;
      }
      if (
        (event.type === 'message_start' && event.message.role === 'assistant') ||
        event.type === 'turn_end'
      )
        return;
    }
    if (
      event.type === 'message_end' &&
      event.message.role === 'assistant' &&
      event.message.stopReason !== 'error' &&
      event.message.stopReason !== 'length'
    )
      overflowRecoveryAttempted = false;
    if (event.type === 'agent_start' && stopRequested) agent.abort();
    if (event.type === 'agent_end') {
      const added = completeSkippedCalls();
      emit({
        type: 'agent',
        event: {
          ...event,
          messages: [
            ...(continuation.cancelledBackoff ? event.messages.slice(0, -1) : event.messages),
            ...added,
          ],
        },
      });
      return;
    }
    emit({ type: 'agent', event });
  });

  function completeSkippedCalls(): ToolResultMessage[] {
    const added: ToolResultMessage[] = [];
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
        const outcome = { content: result.content, details: result.details };
        finalizeTool(call.name, outcome, true, call.arguments);
        result.content = outcome.content;
        result.details = outcome.details;
        messages.push(result);
        added.push(result);
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
    deadline = startedAt + runTimeoutMs;
    runController = new AbortController();
    let contextExceeded = false;
    let outcome: AgentStatus;
    let outcomeDetail: string | undefined;
    const timer = setTimeout(() => {
      budgetReason = `Run time limit reached (${runTimeoutMs}ms)`;
      runController?.abort();
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
        await compactHistory('threshold', true);
        if (!runController.signal.aborted)
          await agent.prompt(prompt, images ? [...images] : undefined);
        while (!runController.signal.aborted) {
          const last = agent.state.messages.at(-1);
          const overflow =
            last?.role === 'assistant' && isContextOverflow(last, model.contextWindow);
          if (!overflow || last.stopReason === 'stop') {
            if (last?.role === 'assistant' && last.stopReason !== 'aborted')
              await compactHistory(
                overflow && last.model === model.id && last.provider === model.provider
                  ? 'overflow'
                  : 'threshold',
                true,
              );
            break;
          }
          contextExceeded = true;
          outcomeDetail = last.errorMessage ?? 'Context exceeds the selected model window';
          if (
            last.model !== model.id ||
            last.provider !== model.provider ||
            overflowRecoveryAttempted ||
            !continuation.compaction.enabled
          )
            break;
          overflowRecoveryAttempted = true;
          agent.state.messages = agent.state.messages.slice(0, -1);
          if (!(await compactHistory('overflow', false, last)) || runController.signal.aborted)
            break;
          contextExceeded = false;
          await agent.continue();
        }
      }
      if (budgetReason) {
        outcome = 'budget-exceeded';
        outcomeDetail = budgetReason;
      } else if (stopRequested) {
        outcome = 'aborted';
        outcomeDetail = undefined;
      } else if (contextExceeded) outcome = 'context-exceeded';
      else if (agent.state.errorMessage) {
        outcome = 'error';
        outcomeDetail = agent.state.errorMessage;
      } else {
        outcome = 'done';
        outcomeDetail = undefined;
      }
    } catch (error) {
      outcome = budgetReason ? 'budget-exceeded' : stopRequested ? 'aborted' : 'error';
      outcomeDetail = error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timer);
      runController = undefined;
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
      overflowRecoveryAttempted = false;
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
      runController?.abort();
      agent.abort();
      await active;
    },
    reset() {
      if (active || reloading) throw new Error('Stop the agent before Reset');
      if (disposed) throw new Error('Agent session is disposed');
      agent.reset();
      continuation.reset();
      previousCall = undefined;
      repeatedCalls = 0;
      deadline = 0;
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
      const usage = { ...continuation.usage };
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
          recipe: options.recipe !== false,
          retry: continuation.retry,
          compaction: continuation.compaction,
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
      // Detached JSON snapshot; provider error text was already scrubbed at ingress.
      return JSON.parse(JSON.stringify(trace)) as AgentTrace;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      stopRequested = true;
      runController?.abort();
      agent.abort();
      await active;
      await pending.catch(() => {});
      detach();
      listeners.clear();
      await host.close();
    },
  };
}
