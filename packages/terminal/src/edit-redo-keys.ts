export interface EditRedoKeyboardEvent {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
}

export function isEditRedoKey(event: EditRedoKeyboardEvent): boolean {
  if (event.altKey || !event.shiftKey) return false;
  if (!event.ctrlKey && !event.metaKey) return false;
  return event.key.toLowerCase() === 'z';
}
