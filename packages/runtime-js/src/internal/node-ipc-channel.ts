import { NotImplementedError } from '@riftydev/vfs';

export interface NodeIpcChannel {
  ref(): never;
  unref(): never;
}

/** Honest finite surface until IPC channel ref accounting is implemented. */
export function nodeIpcChannel(owner: 'child_process' | 'process'): NodeIpcChannel {
  return {
    ref: () => {
      throw new NotImplementedError(`${owner}.channel.ref`);
    },
    unref: () => {
      throw new NotImplementedError(`${owner}.channel.unref`);
    },
  };
}
