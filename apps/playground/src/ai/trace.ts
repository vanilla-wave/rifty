/**
 * Session trace recorder (ADR-0190 / ADR-0191): one JSON per session —
 * transcript, tool calls/results (size-capped), timings, token usage, the
 * terminal output of agent-run shell commands, final git diff and the
 * config snapshot WITHOUT the apiKey ({@link AiConfigSnapshot} is key-free
 * by construction). Downloaded by the "Export session" button; PASS 2 exposes
 * the same object via `__riftyAgentBench.exportTrace()`.
 */
import type { AgentEvent, AgentMessage } from '@earendil-works/pi-agent-core';
import type { DiffEntry } from '@riftydev/git';
import { PROMPT_PROFILE_ID } from './prompt-profile.ts';
import type { AiConfigSnapshot } from './settings.ts';
import { TOOL_RESULT_CAP_BYTES, capToolText } from './truncate.ts';

export interface AiTraceMessage {
  readonly role: string;
  readonly text: string;
  readonly toolCalls?: readonly { id: string; name: string; args: unknown }[];
  readonly usage?: { input: number; output: number; totalTokens: number };
  readonly stopReason?: string;
  readonly errorMessage?: string;
}

export interface AiTraceToolCall {
  id: string;
  name: string;
  args: unknown;
  startedAt: number;
  durationMs?: number;
  result?: string;
  isError?: boolean;
}

export interface AiTraceShellRun {
  readonly command: string;
  readonly exitCode: number;
  readonly output: string;
}

export interface AiTraceRun {
  startedAt: number;
  endedAt?: number;
}

export type AiRunStatus = 'idle' | 'running' | 'done' | 'error' | 'aborted' | 'budget-exceeded';

export interface AiSessionTrace {
  readonly version: 1;
  readonly profile: typeof PROMPT_PROFILE_ID;
  readonly createdAt: string;
  /** Key-free settings slice — the apiKey never enters a trace. */
  readonly config: AiConfigSnapshot;
  readonly caps: { toolResultBytes: number };
  readonly transcript: readonly AiTraceMessage[];
  readonly toolCalls: readonly AiTraceToolCall[];
  readonly terminal: readonly AiTraceShellRun[];
  readonly usage: { input: number; output: number; totalTokens: number };
  readonly timings: { runs: readonly AiTraceRun[] };
  readonly status: AiRunStatus;
  /** Set when a run tripped a budget — a distinct outcome, never a silent stop. */
  readonly budget: { exceeded: boolean; reason?: string };
  readonly finalDiff: readonly DiffEntry[] | { error: string };
}

interface MessageView {
  role: string;
  text: string;
  toolCalls: { id: string; name: string; args: unknown }[];
  usage?: { input: number; output: number; totalTokens: number };
  stopReason?: string;
  errorMessage?: string;
}

function messageView(message: AgentMessage): MessageView {
  const view: MessageView = {
    role: 'role' in message ? message.role : 'unknown',
    text: '',
    toolCalls: [],
  };
  const content: unknown = 'content' in message ? message.content : undefined;
  if (typeof content === 'string') {
    view.text = content;
  } else if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content as readonly Record<string, unknown>[]) {
      if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
      if (block.type === 'toolCall') {
        view.toolCalls.push({
          id: typeof block.id === 'string' ? block.id : '',
          name: typeof block.name === 'string' ? block.name : '',
          args: block.arguments,
        });
      }
    }
    view.text = parts.join('');
  }
  if ('usage' in message) {
    const usage = message.usage as { input: number; output: number; totalTokens: number };
    view.usage = { input: usage.input, output: usage.output, totalTokens: usage.totalTokens };
  }
  if ('stopReason' in message && typeof message.stopReason === 'string') {
    view.stopReason = message.stopReason;
  }
  if ('errorMessage' in message && typeof message.errorMessage === 'string') {
    view.errorMessage = message.errorMessage;
  }
  return view;
}

function contentText(result: unknown): string {
  const content = (result as { content?: unknown })?.content;
  if (!Array.isArray(content)) return '';
  return content
    .filter(
      (block): block is { type: 'text'; text: string } =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string',
    )
    .map((block) => block.text)
    .join('\n');
}

export class AiTraceRecorder {
  readonly #config: AiConfigSnapshot;
  readonly #createdAt: string;
  readonly #transcript: AiTraceMessage[] = [];
  readonly #toolCalls: AiTraceToolCall[] = [];
  readonly #terminal: AiTraceShellRun[] = [];
  readonly #runs: AiTraceRun[] = [];
  #usage = { input: 0, output: 0, totalTokens: 0 };
  #status: AiRunStatus = 'idle';
  #budgetReason: string | null = null;
  readonly #now: () => number;

  constructor(config: AiConfigSnapshot, now: () => number = Date.now) {
    this.#config = config;
    this.#now = now;
    this.#createdAt = new Date(now()).toISOString();
  }

  setStatus(status: AiRunStatus): void {
    this.#status = status;
  }

  markBudgetExceeded(reason: string): void {
    this.#budgetReason = reason;
    this.#status = 'budget-exceeded';
  }

  onEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'agent_start':
        this.#runs.push({ startedAt: this.#now() });
        break;
      case 'agent_end': {
        const run = this.#runs.at(-1);
        if (run && run.endedAt === undefined) run.endedAt = this.#now();
        break;
      }
      case 'message_end': {
        const view = messageView(event.message);
        const capped = capToolText(view.text);
        this.#transcript.push({
          role: view.role,
          text: capped.text,
          ...(view.toolCalls.length > 0 ? { toolCalls: view.toolCalls } : {}),
          ...(view.usage ? { usage: view.usage } : {}),
          ...(view.stopReason !== undefined ? { stopReason: view.stopReason } : {}),
          ...(view.errorMessage !== undefined ? { errorMessage: view.errorMessage } : {}),
        });
        if (view.usage && view.role === 'assistant') {
          this.#usage = {
            input: this.#usage.input + view.usage.input,
            output: this.#usage.output + view.usage.output,
            totalTokens: this.#usage.totalTokens + view.usage.totalTokens,
          };
        }
        break;
      }
      case 'tool_execution_start':
        this.#toolCalls.push({
          id: event.toolCallId,
          name: event.toolName,
          args: event.args,
          startedAt: this.#now(),
        });
        break;
      case 'tool_execution_end': {
        const call = this.#toolCalls.find((c) => c.id === event.toolCallId);
        const resultText = capToolText(contentText(event.result)).text;
        if (call) {
          call.durationMs = this.#now() - call.startedAt;
          call.result = resultText;
          call.isError = event.isError;
        }
        if (event.toolName === 'shell' && !event.isError) {
          const details = (event.result as { details?: { command?: unknown; exitCode?: unknown } })
            ?.details;
          this.#terminal.push({
            command: typeof details?.command === 'string' ? details.command : '',
            exitCode: typeof details?.exitCode === 'number' ? details.exitCode : -1,
            output: resultText,
          });
        }
        break;
      }
      default:
        break;
    }
  }

  snapshot(finalDiff: readonly DiffEntry[] | { error: string }): AiSessionTrace {
    return {
      version: 1,
      profile: PROMPT_PROFILE_ID,
      createdAt: this.#createdAt,
      config: this.#config,
      caps: { toolResultBytes: TOOL_RESULT_CAP_BYTES },
      transcript: [...this.#transcript],
      toolCalls: this.#toolCalls.map((call) => ({ ...call })),
      terminal: [...this.#terminal],
      usage: { ...this.#usage },
      timings: { runs: this.#runs.map((run) => ({ ...run })) },
      status: this.#status,
      budget: this.#budgetReason
        ? { exceeded: true, reason: this.#budgetReason }
        : { exceeded: false },
      finalDiff,
    };
  }
}
