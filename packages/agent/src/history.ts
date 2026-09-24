import type { AgentMessage } from '@earendil-works/pi-agent-core';

/** Validate the native envelope and pairing once, before any host work. */
export function restoreMessages(input: readonly AgentMessage[] = []): AgentMessage[] {
  const fail = (reason: string): never => {
    throw new TypeError(`initialMessages: ${reason}`);
  };
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
