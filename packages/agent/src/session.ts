import { Agent, type AgentMessage, type AgentToolResult } from '@earendil-works/pi-agent-core';
import {
  type AssistantMessage,
  type ImageContent,
  type Message,
  type SystemMessage,
  getCurrentSystemMessage,
  isContextOverflow,
  isRecoverableLength,
} from '@earendil-works/pi-ai';
import { NotImplementedError } from '@riftydev/io';
import { createArchive } from './archive.ts';
import { isOpenAIProvider, selectModel } from './catalog.ts';
import { unsupportedChatCommand } from './chat-command.ts';
import { createContinuation } from './continuation.ts';
import { restoreMessages } from './history.ts';
import {
  type Entry,
  buildProjection,
  calculateContextTokens,
  estimateContextTokens,
  estimateProjectedContextTokens,
  estimateTokens,
  shouldCompact,
} from './pi-cli/compaction.ts';
import { convertToLlm } from './pi-cli/messages.ts';
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
  const archive = options.archive
    ? createArchive(options.archive, initialMessages.length, emit)
    : undefined;
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

  // CLI session journal for compaction (ADR-0474), projected from the audit receipts
  // as they are emitted: discarded attempts stay as omitted entries.
  const journal: Entry[] = [];
  let lastAssistantEntry: string | undefined;
  function journalAppend(
    entry:
      | { type: 'message'; message: AgentMessage }
      | { type: 'context_edit'; targetId: string; replacement: null },
  ): string {
    const id = String(journal.length);
    journal.push({ ...entry, id, timestamp: new Date().toISOString() } as Entry);
    return id;
  }
  function journalMessage(message: AgentMessage) {
    const id = journalAppend({ type: 'message', message: structuredClone(message) });
    if (message.role === 'assistant') lastAssistantEntry = id;
  }
  function journalOmit(targetId: string | undefined) {
    if (targetId !== undefined)
      journalAppend({ type: 'context_edit', targetId, replacement: null });
  }
  function journalRestore(messages: readonly AgentMessage[]) {
    journal.length = 0;
    lastAssistantEntry = undefined;
    // A restored summary is a CLI compaction entry; leading prompt state is its systemMessage.
    const summaryIndex = messages.findIndex(({ role }) => role === 'compactionSummary');
    const head = messages.slice(0, Math.max(0, summaryIndex)) as Message[];
    for (const [index, message] of messages.entries()) {
      if (index < summaryIndex) continue;
      if (message.role !== 'compactionSummary') {
        journalMessage(message);
        continue;
      }
      const id = String(journal.length);
      const systemMessage = getCurrentSystemMessage(head);
      journal.push({
        type: 'compaction',
        id,
        timestamp: new Date(message.timestamp).toISOString(),
        summary: message.summary,
        firstKeptEntryId: id,
        tokensBefore: message.tokensBefore,
        ...('details' in message ? { details: message.details } : {}),
        ...(systemMessage ? { systemMessage } : {}),
      });
    }
  }
  journalRestore(initialMessages);
  function latestCompaction() {
    for (let i = journal.length - 1; i >= 0; i--) {
      const entry = journal[i];
      if (entry?.type === 'compaction') return entry;
    }
    return undefined;
  }

  // CLI `_preparePromptAndToolLoadout`: a changed prompt enters history as a system
  // update before the next request; Pi declares tool changes and collapses it on wire.
  let tools: ReturnType<typeof refreshCapabilities>['tools'] = [];
  function refresh(): SystemMessage | undefined {
    const refreshed = refreshCapabilities();
    tools = refreshed.tools;
    agent.state.tools = tools;
    const prompt = refreshed.systemPrompt;
    if (getCurrentSystemMessage(agent.state.messages)?.sections?.prompt === prompt) return;
    return { role: 'system', content: '', sections: { prompt }, timestamp: Date.now() };
  }

  /** CLI `_runAutoCompaction` + `appendCompaction`; true when a summary was installed. */
  async function compactHistory(reason: 'threshold' | 'overflow') {
    if (!runController) return false;
    const path = [...journal];
    const result = await continuation.compactJournal(path, reason, runController.signal);
    if (!result) return false;
    const timestamp = Date.now();
    const systemMessage = getCurrentSystemMessage(buildProjection(path).messages as Message[]);
    journal.push({
      type: 'compaction',
      id: String(journal.length),
      timestamp: new Date(timestamp).toISOString(),
      summary: result.summary,
      firstKeptEntryId: result.firstKeptEntryId,
      tokensBefore: result.tokensBefore,
      details: result.details,
      ...(systemMessage ? { systemMessage: { ...systemMessage, timestamp } } : {}),
    });
    const projected = buildProjection(journal).messages;
    const summary = projected.find((message) => message.role === 'compactionSummary');
    agent.state.messages = projected;
    emit({
      type: 'compaction',
      phase: 'end',
      reason,
      source: result.source,
      tokensBefore: result.tokensBefore,
      tokensAfter: projected.reduce((total, message) => total + estimateTokens(message), 0),
      success: true,
      ...(summary ? { summary: structuredClone(summary) } : {}),
      retainedMessageCount: projected.filter(
        (message) => message.role !== 'system' && message.role !== 'compactionSummary',
      ).length,
      aborted: false,
      usage: result.usage,
    });
    return true;
  }

  /** CLI `_checkCompaction`; returns whether to continue the interrupted turn. */
  /** CLI `_findPersistedMessageEntryId`: agent state is the journal projection. */
  function entryIdOf(message: AgentMessage): string | undefined {
    const index = agent.state.messages.indexOf(message);
    if (index < 0) return undefined;
    let position = 0;
    for (const entry of buildProjection(journal).entries)
      for (const _ of entry.messages) if (position++ === index) return entry.sourceEntry.id;
    return undefined;
  }

  /** CLI `_omitRecoveryAttempt`: the attempt and its paired results leave model context. */
  function omitRecoveryAttempt(message: AssistantMessage) {
    const calls = new Set(message.content.flatMap((b) => (b.type === 'toolCall' ? [b.id] : [])));
    const messages = agent.state.messages;
    const index = messages.indexOf(message);
    const results: AgentMessage[] = [];
    for (const next of index < 0 ? [] : messages.slice(index + 1)) {
      if (next.role === 'assistant') break;
      if (next.role === 'toolResult' && calls.has(next.toolCallId)) results.push(next);
    }
    const ids = [message, ...results].map(entryIdOf);
    for (const id of ids) journalOmit(id);
    agent.state.messages = buildProjection(journal).messages;
  }

  /** CLI `_checkCompaction`; returns whether to continue the interrupted turn. */
  async function checkCompaction(last: AssistantMessage): Promise<'continue' | 'done'> {
    const compaction = latestCompaction();
    if (compaction && last.timestamp <= new Date(compaction.timestamp).getTime()) return 'done';
    const sameModel = last.model === model.id && last.provider === model.provider;
    const projection = buildProjection(journal);
    const entryId = entryIdOf(last);
    const assistantIsProjected =
      entryId === undefined ||
      projection.entries.some(
        (entry) =>
          entry.sourceEntry.id === entryId &&
          entry.messages.some((message) => message.role === 'assistant'),
      );
    const position = entryId === undefined ? -1 : journal.findIndex(({ id }) => id === entryId);
    const after = position >= 0 ? journal.slice(position + 1) : [];
    const retainedForExplicitRecovery =
      entryId === undefined ||
      (!after.some(({ type }) => type === 'compaction') &&
        !after.some((entry) => entry.type === 'context_edit' && entry.targetId === entryId));
    const usageMatchesProjection =
      assistantIsProjected && !after.some(({ type }) => type === 'context_edit');
    const contextOverflow =
      sameModel &&
      ((last.stopReason === 'error' && isContextOverflow(last) && retainedForExplicitRecovery) ||
        (usageMatchesProjection && isContextOverflow(last, model.contextWindow)));
    const recoverableLength =
      sameModel && assistantIsProjected && isRecoverableLength(last, model.maxTokens);
    if (contextOverflow || recoverableLength) {
      if (last.stopReason === 'stop') {
        await compactHistory('overflow');
        return 'done';
      }
      if (overflowRecoveryAttempted) {
        const estimate = estimateProjectedContextTokens(projection, journal);
        emit({
          type: 'compaction',
          phase: 'end',
          reason: 'overflow',
          source: estimate.lastUsageIndex === null ? 'estimate' : 'usage',
          tokensBefore: estimate.tokens,
          success: false,
          aborted: false,
          errorMessage: contextOverflow
            ? 'Context overflow recovery failed after one compact-and-retry attempt. Try reducing context or switching to a larger-context model.'
            : 'Truncated response recovery failed after one compact-and-retry attempt.',
        });
        return 'done';
      }
      overflowRecoveryAttempted = true;
      omitRecoveryAttempt(last);
      return (await compactHistory('overflow')) ? 'continue' : 'done';
    }
    const path = journal;
    const direct = calculateContextTokens(last.usage);
    let tokens: number;
    if (projection.entries.some((entry) => entry.sourceEntry.type === 'context_edit'))
      tokens = estimateProjectedContextTokens(projection, path).tokens;
    else if (last.stopReason === 'error' || direct === 0) {
      const messages = agent.state.messages;
      const estimate = estimateContextTokens(messages);
      const source =
        estimate.lastUsageIndex === null ? undefined : messages[estimate.lastUsageIndex];
      if (
        compaction &&
        source?.role === 'assistant' &&
        source.timestamp <= new Date(compaction.timestamp).getTime()
      )
        return 'done';
      tokens = estimate.tokens;
    } else tokens = direct;
    if (shouldCompact(tokens, model.contextWindow, continuation.compaction))
      await compactHistory('threshold');
    return 'done';
  }

  function emit(event: AgentSessionEvent): void {
    if (event.type === 'agent' && event.event.type === 'message_end')
      journalMessage(event.event.message);
    if (event.type === 'retry' && event.phase === 'start' && event.message) {
      journalMessage(event.message);
      journalOmit(lastAssistantEntry);
    }
    archive?.observe(event);
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
    const standard = [...standardTools(host.root, capabilities, emit), ...(archive?.tools ?? [])];
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

  refreshCapabilities();
  const agent: Agent = new Agent({
    initialState: {
      model,
      thinkingLevel: requestDefaults().reasoning ?? 'off',
      messages: initialMessages,
    },
    toolExecution: 'sequential',
    convertToLlm,
    streamFn: continuation.stream,
    prepareNextTurnWithContext: async (context) => {
      // CLI `_compactBeforeNextAssistantResponse`: projected threshold estimate.
      const path = journal;
      if (
        shouldCompact(
          estimateProjectedContextTokens(buildProjection(path), path).tokens,
          model.contextWindow,
          continuation.compaction,
        )
      )
        await compactHistory('threshold');
      const update = refresh();
      return {
        model,
        thinkingLevel: requestDefaults().reasoning ?? 'off',
        context: { ...context.context, tools, messages: agent.state.messages.slice() },
        ...(update ? { messages: [update] } : {}),
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
  const detach = agent.subscribe(async (event) => {
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
    // CLI resets recovery when a user message starts, after the pre-prompt check.
    if (event.type === 'message_start' && event.message.role === 'user')
      overflowRecoveryAttempted = false;
    if (event.type === 'agent_start' && stopRequested) agent.abort();
    if (event.type === 'agent_end' && continuation.cancelledBackoff) {
      emit({ type: 'agent', event: { ...event, messages: event.messages.slice(0, -1) } });
      return;
    }
    emit({ type: 'agent', event });
    await archive?.flush();
  });

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
        checkImages(images);
        await archive?.begin();
        // CLI `_prepareRun`: check the last response, aborted included; never continue here.
        const previous = [...agent.state.messages]
          .reverse()
          .find((message) => message.role === 'assistant');
        if (previous && continuation.compaction.enabled) await checkCompaction(previous);
        const update = refresh();
        if (!runController.signal.aborted)
          await agent.prompt([
            ...(update ? [update] : []),
            {
              role: 'user',
              content: [{ type: 'text', text: prompt }, ...(images ?? [])],
              timestamp: Date.now(),
            },
          ]);
        while (!runController.signal.aborted) {
          const last = agent.state.messages.at(-1);
          if (last?.role !== 'assistant' || last.stopReason === 'aborted') break;
          const overflow =
            last.stopReason !== 'stop' && isContextOverflow(last, model.contextWindow);
          const next = continuation.compaction.enabled ? await checkCompaction(last) : 'done';
          if (next === 'continue' && !runController.signal.aborted) {
            await agent.continue();
            continue;
          }
          if (overflow) {
            contextExceeded = true;
            outcomeDetail = last.errorMessage ?? 'Context exceeds the selected model window';
          }
          break;
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
    try {
      await archive?.finish(outcome === 'done');
    } catch (error) {
      outcome = 'error';
      outcomeDetail = `Archive: ${error instanceof Error ? error.message : String(error)}`;
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
      archive?.reset();
      agent.reset();
      // Pi keeps its seeded system message; a reset session starts with no prompt state.
      agent.state.messages = [];
      journalRestore([]);
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
