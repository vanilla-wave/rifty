import { describe, expect, it } from 'vitest';
import { type AiPhase, activityLabel } from './AiChatPanel.tsx';

describe('activityLabel', () => {
  it('maps each run phase to a human heartbeat label', () => {
    expect(activityLabel('waiting')).toBe('Waiting for the model');
    expect(activityLabel('thinking')).toBe('Thinking');
    expect(activityLabel('responding')).toBe('Responding');
    expect(activityLabel({ tool: 'shell' })).toBe('Running shell');
    expect(activityLabel({ tool: 'write_file' })).toBe('Running write_file');
  });

  it('covers the phase union exhaustively', () => {
    const phases: AiPhase[] = ['waiting', 'thinking', 'responding', { tool: 'grep' }];
    for (const phase of phases) expect(activityLabel(phase)).not.toBe('');
  });
});
