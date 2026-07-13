import { expect, it, vi } from 'vitest';
import { closeTerminalSession } from './terminal-session-close.ts';

it('detaches the PAGE writer before a remote close that never settles', () => {
  const writer = vi.fn();
  let attachedWriter: ((chunk: string) => void) | undefined = writer;
  const remoteClose = new Promise<void>(() => {});
  const onClosed = vi.fn();
  const onError = vi.fn();

  closeTerminalSession({
    detachWriter: () => {
      attachedWriter = undefined;
    },
    closeRemote: () => remoteClose,
    onClosed,
    onError,
  });
  attachedWriter?.('late output');

  expect(writer).not.toHaveBeenCalled();
  expect(onClosed).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});
