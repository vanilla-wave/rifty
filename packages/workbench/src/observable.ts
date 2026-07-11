export type SnapshotListener<State> = (snapshot: State) => void;

export interface SnapshotObservable<State> {
  snapshot(): State;
  subscribe(listener: SnapshotListener<State>): () => void;
}

export interface MutableSnapshotObservable<State> extends SnapshotObservable<State> {
  notify(): void;
  dispose(): void;
}

/** Framework-free external-store seam: read current state, then observe changes. */
export function createSnapshotObservable<State>(
  read: () => State,
): MutableSnapshotObservable<State> {
  const listeners = new Set<SnapshotListener<State>>();

  return {
    snapshot: read,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    notify() {
      const snapshot = read();
      notifySubscribers(listeners, snapshot);
    },
    dispose() {
      listeners.clear();
    },
  };
}
import { notifySubscribers } from './fault-boundary.ts';
