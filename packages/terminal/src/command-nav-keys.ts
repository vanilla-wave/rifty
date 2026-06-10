export type CommandNavAction = 'jump-prev' | 'jump-next' | 'select-prev' | 'select-next' | 'ignore';

export interface CommandNavKeyLike {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

export function classifyCommandNavKey(event: CommandNavKeyLike): CommandNavAction {
  if (event.altKey) return 'ignore';
  if (!event.ctrlKey && !event.metaKey) return 'ignore';
  if (event.key === 'ArrowUp') return event.shiftKey ? 'select-prev' : 'jump-prev';
  if (event.key === 'ArrowDown') return event.shiftKey ? 'select-next' : 'jump-next';
  return 'ignore';
}
