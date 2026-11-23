import type { AgentMessage } from '@earendil-works/pi-agent-core';

/** Pi 1.x history interleaves prompt-state system messages; tests read the conversation. */
export function conversation(messages: readonly AgentMessage[]): AgentMessage[] {
  return messages.filter(({ role }) => role !== 'system');
}
