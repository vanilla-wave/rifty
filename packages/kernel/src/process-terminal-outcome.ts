export type ProcessTerminalOutcome =
  | { readonly kind: 'exit'; readonly code: unknown; readonly signal: unknown }
  | { readonly kind: 'peererror'; readonly error: unknown };

export interface ProcessTerminalEventSource {
  on(event: 'exit' | 'peererror', listener: (...args: unknown[]) => void): unknown;
  off(event: 'exit' | 'peererror', listener: (...args: unknown[]) => void): unknown;
}

/** Observe the first truthful terminal outcome: Node exit tuple or physical peer death. */
export function observeProcessTerminalOutcome(
  source: ProcessTerminalEventSource,
  listener: (outcome: ProcessTerminalOutcome) => void,
): () => void {
  let active = true;
  const onExit = (code: unknown, signal: unknown): void => {
    settle({ kind: 'exit', code, signal });
  };
  const onPeerError = (error: unknown): void => {
    settle({ kind: 'peererror', error });
  };
  const detach = (): void => {
    source.off('exit', onExit);
    source.off('peererror', onPeerError);
  };
  const settle = (outcome: ProcessTerminalOutcome): void => {
    if (!active) return;
    active = false;
    detach();
    listener(outcome);
  };
  source.on('exit', onExit);
  source.on('peererror', onPeerError);
  return () => {
    if (!active) return;
    active = false;
    detach();
  };
}
