import type { IpcFrame } from './process-manager.ts';
import { readKernelProcessSpec } from './shared-globals.ts';

export interface WorkerControlChannel {
  send(message: unknown): void;
  onMessage(handler: (message: unknown) => void): () => void;
}

/** Child-realm internal control adapter; hides framing and never touches runtime IPC. */
export function readWorkerControlChannel(): WorkerControlChannel | null {
  const port = readKernelProcessSpec()?.stdio.ipc;
  if (!port) return null;
  return {
    send(message): void {
      port.postMessage({ kind: 'control:message', payload: message } satisfies IpcFrame);
    },
    onMessage(handler): () => void {
      const listener = (event: MessageEvent): void => {
        const frame = event.data as IpcFrame | undefined;
        if (frame?.kind === 'control:message') handler(frame.payload);
      };
      port.addEventListener('message', listener);
      port.start();
      return () => port.removeEventListener('message', listener);
    },
  };
}
