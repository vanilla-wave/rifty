export type ClipboardKeyAction = 'allow-terminal-input' | 'copy-selection' | 'ignore';

export interface ClipboardKeyLike {
  readonly type: string;
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

export interface ClipboardKeyContext {
  readonly hasSelection: boolean;
  readonly isMac: boolean;
}

export function classifyClipboardKey(
  event: ClipboardKeyLike,
  ctx: ClipboardKeyContext,
): ClipboardKeyAction {
  if (event.type !== 'keydown') return 'ignore';
  if (event.altKey) return 'ignore';
  if (event.key.toLowerCase() !== 'c') return 'ignore';

  const ctrlCopy = event.ctrlKey && !event.metaKey;
  const metaCopy = ctx.isMac && event.metaKey && !event.ctrlKey;
  if (!ctrlCopy && !metaCopy) return 'ignore';

  if (ctx.hasSelection) return 'copy-selection';
  return ctrlCopy && !event.shiftKey ? 'allow-terminal-input' : 'ignore';
}
