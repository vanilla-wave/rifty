import type { AgentMessage } from '@earendil-works/pi-agent-core';

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function usage(value: unknown): boolean {
  return (
    record(value) &&
    ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens'].every((key) =>
      Number.isFinite(value[key]),
    ) &&
    record(value.cost) &&
    ['input', 'output', 'cacheRead', 'cacheWrite', 'total'].every((key) =>
      Number.isFinite((value.cost as Record<string, unknown>)[key]),
    )
  );
}

/** Validate required Pi 0.85.1 fields and pairing once, before any host work. */
export function restoreMessages(input: readonly AgentMessage[] = []): AgentMessage[] {
  function fail(reason: string): never {
    throw new TypeError(`initialMessages: ${reason}`);
  }
  if (!Array.isArray(input)) fail('expected a native message array');
  const pending = new Map<string, string>();
  for (const message of input) {
    if (
      !message ||
      (message.role !== 'user' && message.role !== 'assistant' && message.role !== 'toolResult') ||
      !Number.isFinite(message.timestamp) ||
      !(typeof message.content === 'string' || Array.isArray(message.content)) ||
      (message.role !== 'user' && !Array.isArray(message.content))
    )
      fail('expected user, assistant or toolResult with timestamp and native content');
    if (
      message.role === 'assistant' &&
      (![message.api, message.provider, message.model].every(
        (value) => typeof value === 'string',
      ) ||
        !['pending', 'stop', 'length', 'toolUse', 'error', 'aborted', 'deferred'].includes(
          message.stopReason,
        ) ||
        !usage(message.usage))
    )
      fail('assistant requires native identity, stopReason and usage');
    if (
      message.role === 'toolResult' &&
      (typeof message.isError !== 'boolean' ||
        (message.usage !== undefined && !usage(message.usage)))
    )
      fail('toolResult requires boolean isError and native usage when supplied');
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        if (!record(block)) fail('expected native content blocks');
        switch (block.type) {
          case 'text':
            if (typeof block.text !== 'string') fail('text block requires text');
            break;
          case 'image':
            if (
              message.role === 'assistant' ||
              typeof block.data !== 'string' ||
              typeof block.mimeType !== 'string'
            )
              fail('user/toolResult image requires data and mimeType');
            break;
          case 'thinking':
            if (message.role !== 'assistant' || typeof block.thinking !== 'string')
              fail('assistant thinking block requires thinking');
            break;
          case 'toolCall':
            if (message.role !== 'assistant' || !record(block.arguments))
              fail('assistant tool call requires arguments object');
            break;
          default:
            fail('unsupported native content block');
        }
      }
    }
    if (message.role === 'toolResult') {
      if (!pending.has(message.toolCallId) || pending.get(message.toolCallId) !== message.toolName)
        fail(`orphan, duplicate or mismatched tool result ${message.toolCallId}`);
      pending.delete(message.toolCallId);
      continue;
    }
    if (pending.size) fail(`missing tool result for ${[...pending.keys()].join(', ')}`);
    if (message.role !== 'assistant') continue;
    for (const block of message.content) {
      if (!block || typeof block !== 'object') fail('expected native assistant content blocks');
      if (block.type !== 'toolCall') continue;
      if (
        typeof block.id !== 'string' ||
        !block.id ||
        typeof block.name !== 'string' ||
        !block.name
      )
        fail('tool calls require an id and name');
      if (pending.has(block.id)) fail(`duplicate tool call ${block.id}`);
      pending.set(block.id, block.name);
    }
  }
  if (pending.size) fail(`missing tool result for ${[...pending.keys()].join(', ')}`);
  return structuredClone([...input]);
}
