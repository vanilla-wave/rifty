import type { TerminalCommandBlock } from './terminal.ts';

export type TerminalCommandBlockStatus = 'ok' | 'error' | 'running';

export interface TerminalCommandBlockRailItem {
  readonly id: number;
  readonly command: string;
  readonly active: boolean;
  readonly status: TerminalCommandBlockStatus;
  readonly title: string;
}

export function commandBlockAtViewport(
  blocks: readonly TerminalCommandBlock[],
  viewportLine: number,
): TerminalCommandBlock | null {
  return (
    blocks
      .slice()
      .reverse()
      .find((item) => item.startLine <= viewportLine) ?? null
  );
}

export function commandBlockStatus(block: TerminalCommandBlock): TerminalCommandBlockStatus {
  if (block.exitCode == null) return 'running';
  return block.exitCode === 0 ? 'ok' : 'error';
}

export function commandBlockRailItems(
  blocks: readonly TerminalCommandBlock[],
  viewportLine: number,
  limit = 8,
): readonly TerminalCommandBlockRailItem[] {
  const active = commandBlockAtViewport(blocks, viewportLine);
  return blocks.slice(-limit).map((block) => {
    const status = commandBlockStatus(block);
    const suffix =
      status === 'running' ? 'running' : block.exitCode === 0 ? 'exit 0' : `exit ${block.exitCode}`;
    return {
      id: block.id,
      command: block.command,
      active: block.id === active?.id,
      status,
      title: `${block.command} — ${suffix}`,
    };
  });
}
