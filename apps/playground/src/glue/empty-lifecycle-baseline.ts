/** Reserved persisted baseline adopted when the first-run chooser is dismissed. */
export const EMPTY_LIFECYCLE_BASELINE_ID = 'hidden-empty';

export function isEmptyLifecycleBaseline(id: string | undefined): boolean {
  return id === EMPTY_LIFECYCLE_BASELINE_ID;
}
