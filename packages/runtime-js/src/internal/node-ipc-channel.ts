import { NotImplementedError } from '@riftydev/io';

export interface NodeIpcChannel {
  ref(): never;
  unref(): never;
}

type NodeIpcChannelOwner = 'process' | 'child_process';

/** Public Node channel shape without leaking the shared kernel control port. */
export function createNodeIpcChannel(owner: NodeIpcChannelOwner): NodeIpcChannel {
  const unsupported = (method: 'ref' | 'unref'): never => {
    throw new NotImplementedError(
      `${owner}.channel.${method}`,
      'browser Worker IPC liveness is not wired independently of kernel control',
    );
  };
  return {
    ref: () => unsupported('ref'),
    unref: () => unsupported('unref'),
  };
}
