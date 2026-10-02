import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { ImageContent } from '@earendil-works/pi-ai';
import type { AgentSessionEvent, AgentStatus } from './types.ts';

type CapabilityEvent = Extract<AgentSessionEvent, { type: 'capabilities' }>;
type NoticeEvent = Extract<
  AgentSessionEvent,
  { type: 'status' | 'capabilities' | 'model' | 'compaction' | 'repeated-call' | 'retry' }
>;

export interface AgentTranscriptResult {
  readonly content: readonly { readonly type: string; readonly text?: string }[];
  readonly details?: unknown;
}

export type AgentTranscriptItem =
  | {
      readonly kind: 'message';
      readonly id: number;
      readonly role: 'user' | 'assistant';
      readonly text: string;
      readonly streamingText?: string;
      readonly message?: AgentMessage;
      readonly images?: readonly ImageContent[];
    }
  | {
      readonly kind: 'tool';
      readonly id: number;
      readonly callId: string;
      readonly name: string;
      readonly args?: unknown;
      readonly state: 'pending' | 'running' | 'success' | 'error' | 'cancelled';
      readonly result?: AgentTranscriptResult;
      readonly output: readonly { readonly chunk: string; readonly stream: 'stdout' | 'stderr' }[];
    }
  | { readonly kind: 'notice'; readonly id: number; readonly event: NoticeEvent }
  | (Extract<AgentSessionEvent, { type: 'output' }> & {
      readonly kind: 'output';
      readonly id: number;
    });

/** Pass the complete state back to the reducer; ids remain stable until reset. */
export interface AgentTranscript {
  readonly items: readonly AgentTranscriptItem[];
  readonly status: AgentStatus;
  readonly detail?: string;
  readonly capabilities?: CapabilityEvent;
  readonly nextId: number;
  readonly assistantId?: number;
}

export function createAgentTranscript(): AgentTranscript {
  return { items: [], status: 'idle', nextId: 1 };
}

function messageText(message: AgentMessage): string {
  if (message.role !== 'user' && message.role !== 'assistant') return '';
  return typeof message.content === 'string'
    ? message.content
    : message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('');
}

function resultState(result: AgentTranscriptResult, isError: boolean) {
  const details = result.details;
  return isError &&
    details !== null &&
    typeof details === 'object' &&
    'status' in details &&
    details.status === 'cancelled'
    ? ('cancelled' as const)
    : isError
      ? ('error' as const)
      : ('success' as const);
}

/** Native events are the authority; a terminal status never fabricates tool effects. */
export function reduceAgentTranscript(
  state: AgentTranscript,
  event: AgentSessionEvent,
): AgentTranscript {
  if (event.type === 'status' && event.status === 'idle') return createAgentTranscript();
  let items = state.items;
  let nextId = state.nextId;
  let assistantId = state.assistantId;
  let status = state.status;
  let detail = state.detail;
  let capabilities = state.capabilities;
  const append = (item: AgentTranscriptItem) => {
    items = [...items, item];
  };
  const notice = (value: NoticeEvent) =>
    append({ kind: 'notice', id: nextId++, event: structuredClone(value) });
  const update = (
    id: number | undefined,
    transform: (item: AgentTranscriptItem) => AgentTranscriptItem,
  ) => {
    items = items.map((item) => (item.id === id ? transform(item) : item));
  };
  const ensureAssistant = () => {
    if (assistantId !== undefined) return;
    assistantId = nextId++;
    append({ kind: 'message', id: assistantId, role: 'assistant', text: '', streamingText: '' });
  };
  const lastMatching = (predicate: (item: AgentTranscriptItem) => boolean) => {
    for (let index = items.length - 1; index >= 0; index--)
      if (predicate(items[index]!)) return items[index];
    return undefined;
  };
  const currentTool = (callId: string) =>
    lastMatching((item) => item.kind === 'tool' && item.callId === callId);
  const startTool = (callId: string, name: string, args: unknown, running: boolean) => {
    const current = currentTool(callId);
    if (current?.kind === 'tool' && (current.state === 'pending' || current.state === 'running')) {
      update(current.id, (item) =>
        item.kind === 'tool'
          ? { ...item, args: structuredClone(args), state: running ? 'running' : item.state }
          : item,
      );
    } else {
      append({
        kind: 'tool',
        id: nextId++,
        callId,
        name,
        args: structuredClone(args),
        state: running ? 'running' : 'pending',
        output: [],
      });
    }
  };
  const settleTool = (callId: string, name: string, value: unknown, isError: boolean) => {
    const result = structuredClone(value) as AgentTranscriptResult;
    const current = currentTool(callId);
    if (current?.kind === 'tool') {
      update(current.id, (item) =>
        item.kind === 'tool' ? { ...item, result, state: resultState(result, isError) } : item,
      );
    } else {
      append({
        kind: 'tool',
        id: nextId++,
        callId,
        name,
        state: resultState(result, isError),
        result,
        output: [],
      });
    }
  };

  switch (event.type) {
    case 'status':
      status = event.status;
      detail = event.detail;
      if (status === 'budget-exceeded' || status === 'context-exceeded') notice(event);
      break;
    case 'capabilities': {
      const equal = (left: readonly string[], right: readonly string[]) =>
        left.length === right.length && left.every((value, index) => value === right[index]);
      if (
        !capabilities ||
        !equal(capabilities.tools, event.tools) ||
        !equal(capabilities.notes, event.notes)
      ) {
        capabilities = structuredClone(event);
        notice(event);
      }
      break;
    }
    case 'resources':
      return state;
    case 'model':
    case 'compaction':
    case 'repeated-call':
      notice(event);
      break;
    case 'retry':
      if (event.source === 'assistant' && event.phase === 'start') {
        items = items.filter(
          (item) =>
            !(item.id === assistantId && item.kind === 'message' && item.message === undefined),
        );
        assistantId = undefined;
      }
      notice(event);
      break;
    case 'output': {
      // AgentSession dispatches tools sequentially; no extra correlation owner.
      const current = lastMatching(
        (item) => item.kind === 'tool' && item.name === 'shell' && item.state === 'running',
      );
      if (current?.kind === 'tool')
        update(current.id, (item) =>
          item.kind === 'tool'
            ? { ...item, output: [...item.output, { chunk: event.chunk, stream: event.stream }] }
            : item,
        );
      else append({ ...event, kind: 'output', id: nextId++ });
      break;
    }
    case 'agent': {
      const native = event.event;
      if (native.type === 'message_start') {
        if (native.message.role === 'user') {
          const message = structuredClone(native.message);
          append({
            kind: 'message',
            id: nextId++,
            role: 'user',
            text: messageText(message),
            message,
            images: Array.isArray(message.content)
              ? message.content.filter((part) => part.type === 'image')
              : [],
          });
        } else if (native.message.role === 'assistant') {
          assistantId = nextId++;
          append({
            kind: 'message',
            id: assistantId,
            role: 'assistant',
            text: '',
            streamingText: messageText(native.message),
          });
        }
      } else if (native.type === 'message_update' && native.message.role === 'assistant') {
        // Pi may resume a retried stream without another message_start.
        ensureAssistant();
        update(assistantId, (item) =>
          item.kind === 'message' ? { ...item, streamingText: messageText(native.message) } : item,
        );
      } else if (native.type === 'message_end') {
        if (native.message.role === 'assistant') {
          ensureAssistant();
          const message = structuredClone(native.message);
          update(assistantId, (item) => {
            if (item.kind !== 'message') return item;
            const { streamingText: _streaming, ...finished } = item;
            return { ...finished, text: messageText(message), message };
          });
          assistantId = undefined;
          if (message.stopReason !== 'error' && message.stopReason !== 'aborted') {
            for (const call of message.content)
              if (call.type === 'toolCall') startTool(call.id, call.name, call.arguments, false);
          }
        } else if (native.message.role === 'toolResult') {
          settleTool(
            native.message.toolCallId,
            native.message.toolName,
            native.message,
            native.message.isError,
          );
        }
      } else if (native.type === 'tool_execution_start') {
        startTool(native.toolCallId, native.toolName, native.args, true);
      } else if (native.type === 'tool_execution_end') {
        settleTool(native.toolCallId, native.toolName, native.result, native.isError);
      } else if (native.type === 'agent_end') {
        // Budget/abort may report only a terminal tail. Preserve all prior rows.
        for (const message of native.messages)
          if (message.role === 'toolResult')
            settleTool(message.toolCallId, message.toolName, message, message.isError);
      }
      break;
    }
  }
  return { items, nextId, assistantId, status, detail, capabilities };
}
