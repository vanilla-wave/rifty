/**
 * `node:http.Agent` — twin of the `https.Agent` ceiling (ADR-0181 D3, ADR-0464):
 * an Agent owns a socket pool the browser runtime has none of. Declaring a
 * subclass works as in Node; constructing throws.
 */
import { NotImplementedError } from '@riftydev/io';

export class Agent {
  constructor(_options?: unknown) {
    throw new NotImplementedError(
      'node:http.Agent',
      'an http Agent controls a socket pool that does not exist in the browser runtime',
    );
  }
}
