export type NodeHostUnhandledRejection = (reason: unknown, promise: Promise<unknown>) => void;

interface NodeHostRejectionEvents {
  on(event: 'unhandledRejection', listener: NodeHostUnhandledRejection): unknown;
  on(event: 'rejectionHandled', listener: (promise: Promise<unknown>) => void): unknown;
}

/** Mirror browser rejection events without Node host warnings entering guest stderr. */
export function installNodeHostRejectionEvents(
  hostProcess: NodeHostRejectionEvents,
  onUnhandled: NodeHostUnhandledRejection,
): void {
  hostProcess.on('unhandledRejection', onUnhandled);
  hostProcess.on('rejectionHandled', () => {});
}
