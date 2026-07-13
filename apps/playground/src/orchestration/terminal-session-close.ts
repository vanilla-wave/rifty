export interface TerminalSessionClosePorts {
  detachWriter(): void;
  closeRemote(): Promise<void>;
  onClosed(): void;
  onError(error: unknown): void;
}

/** Drop PAGE output ownership before waiting for the owner's physical close ACK. */
export function closeTerminalSession(ports: TerminalSessionClosePorts): void {
  ports.detachWriter();
  let remoteClose: Promise<void>;
  try {
    remoteClose = ports.closeRemote();
  } catch (error) {
    ports.onError(error);
    return;
  }
  void remoteClose.then(ports.onClosed, ports.onError);
}
