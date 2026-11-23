// Ported from pi-coding-agent 1.6.0 src/core/messages.ts (MIT, see ../../THIRD_PARTY_NOTICES.md).
// Only the compaction-summary message type rifty produces; kill condition: ADR-0569.
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import type { Message } from '@earendil-works/pi-ai';

export const COMPACTION_SUMMARY_PREFIX = `The conversation history before this point was compacted into the following summary:

<summary>
`;

export const COMPACTION_SUMMARY_SUFFIX = `
</summary>`;

export interface CompactionSummaryMessage {
  role: 'compactionSummary';
  summary: string;
  tokensBefore: number;
  timestamp: number;
}

declare module '@earendil-works/pi-agent-core' {
  interface CustomAgentMessages {
    compactionSummary: CompactionSummaryMessage;
  }
}

export function createCompactionSummaryMessage(
  summary: string,
  tokensBefore: number,
  timestamp: string | number,
): CompactionSummaryMessage {
  return {
    role: 'compactionSummary',
    summary,
    tokensBefore,
    timestamp: new Date(timestamp).getTime(),
  };
}

/** CLI `convertToLlm` for the message roles rifty admits. */
export function convertToLlm(messages: AgentMessage[]): Message[] {
  return messages.flatMap((m): Message[] => {
    if (m.role === 'compactionSummary')
      return [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: COMPACTION_SUMMARY_PREFIX + m.summary + COMPACTION_SUMMARY_SUFFIX,
            },
          ],
          timestamp: m.timestamp,
        },
      ];
    if (
      m.role === 'system' ||
      m.role === 'user' ||
      m.role === 'assistant' ||
      m.role === 'toolResult'
    )
      return [m];
    return [];
  });
}
