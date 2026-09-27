import { NotImplementedError } from '@riftydev/io';

/** Importable/subclassable; browser fetch exposes no configurable socket pool. */
export class Agent {
  constructor(..._args: unknown[]) {
    throw new NotImplementedError(
      'node:http.Agent',
      'a custom http Agent controls a socket pool unavailable in the browser runtime',
    );
  }
}
