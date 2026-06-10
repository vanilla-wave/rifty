import type { TerminalCompletionItem, TerminalCompletionResult } from './terminal.ts';

export interface TerminalAutocompleteState {
  readonly start: number;
  readonly end: number;
  readonly index: number;
  readonly items: readonly TerminalCompletionItem[];
}

export function createAutocompleteState(
  result: TerminalCompletionResult | null,
): TerminalAutocompleteState | null {
  if (!result || result.items.length === 0) return null;
  const start = Math.max(0, result.start);
  const end = Math.max(start, result.end);
  return { start, end, index: 0, items: result.items };
}

export function moveAutocompleteIndex(
  state: TerminalAutocompleteState,
  delta: number,
): TerminalAutocompleteState {
  const length = state.items.length;
  if (length === 0) return state;
  return { ...state, index: (state.index + delta + length) % length };
}

export function applyAutocompleteItem(
  line: string,
  range: Pick<TerminalAutocompleteState, 'start' | 'end'>,
  item: TerminalCompletionItem | undefined,
): { readonly line: string; readonly cursor: number } {
  const start = Math.max(0, Math.min(range.start, line.length));
  const end = Math.max(start, Math.min(range.end, line.length));
  const value = item?.value ?? '';
  return {
    line: `${line.slice(0, start)}${value}${line.slice(end)}`,
    cursor: start + value.length,
  };
}
