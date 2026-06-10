import type { TerminalCommandBlock } from '@riftydev/terminal';
import { describe, expect, it } from 'vitest';
import { commandBlockAtViewport, commandBlockRailItems } from './command-blocks.ts';

const blocks: readonly TerminalCommandBlock[] = [
  { id: 1, command: 'echo one', exitCode: 0, startLine: 2, endLine: 4 },
  { id: 2, command: 'bad', exitCode: 127, startLine: 8, endLine: 10 },
  { id: 3, command: 'sleep 1', startLine: 13, endLine: 13 },
];

describe('terminal command block helpers', () => {
  it('finds the block active at the viewport top', () => {
    expect(commandBlockAtViewport(blocks, 9)?.id).toBe(2);
    expect(commandBlockAtViewport(blocks, 12)?.id).toBe(2);
    expect(commandBlockAtViewport(blocks, 1)).toBeNull();
  });

  it('builds recent rail items with active and status state', () => {
    expect(commandBlockRailItems(blocks, 9, 2)).toEqual([
      {
        id: 2,
        command: 'bad',
        active: true,
        status: 'error',
        title: 'bad — exit 127',
      },
      {
        id: 3,
        command: 'sleep 1',
        active: false,
        status: 'running',
        title: 'sleep 1 — running',
      },
    ]);
  });
});
