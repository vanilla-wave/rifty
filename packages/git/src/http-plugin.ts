/**
 * isomorphic-git `http` plugin backed by `@riftydev/net` egress.
 *
 * isomorphic-git ships a stock web-fetch http client; we deliberately route
 * git smart-HTTP through `@riftydev/net`'s node-style `request` instead, so git
 * shares the exact `node:http` egress + port-registry routing every other Node
 * program in rifty uses (external `https:` falls through to the host `fetch`
 * inside net — see ADR-0017 / D-005). Same observable behaviour as a Node git
 * client driving `http.request`.
 *
 * Contract (isomorphic-git 1.38.5): `{ async request(opts) }` where
 *   opts = { url, method, headers, body, signal }
 *     - body: AsyncIterableIterator<Uint8Array> | undefined
 *     - headers: Record<string,string>
 * returning `{ url, method, statusCode, statusMessage, headers, body }` with
 * `body: AsyncIterableIterator<Uint8Array>`.
 */

import { request as netRequest } from '@riftydev/net';

export interface GitHttpRequest {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Record<string, string>;
  /** Outgoing body, streamed chunk-by-chunk into the net request. */
  readonly body?: AsyncIterableIterator<Uint8Array> | undefined;
  /** Abort signal forwarded to the net request. */
  readonly signal?: AbortSignal | undefined;
}

export interface GitHttpResponse {
  readonly url: string;
  readonly method: string;
  readonly statusCode: number;
  readonly statusMessage: string;
  readonly headers: Record<string, string>;
  /** Response body as an async-iterable of Uint8Array (drained from net). */
  readonly body: AsyncIterableIterator<Uint8Array>;
}

/**
 * Minimal structural shape of net's `IncomingMessageFromFetch` the plugin
 * touches: a Node-Readable EventEmitter with the status/header trio. Kept local
 * (not imported) so the plugin stays decoupled from net's class identity.
 */
interface NetResponse {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
  on(event: 'data', listener: (chunk: Uint8Array) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
  on(event: 'error', listener: (err: Error) => void): unknown;
}

/**
 * Drain a net response (Node-Readable) into an async-iterable of Uint8Array.
 *
 * Listeners attach EAGERLY (at call time, not on first `for await`) so chunks
 * emitted before the git caller starts iterating the body are buffered rather
 * than dropped — the caller resolves `{ ...response }` first and iterates the
 * body slightly later. Buffers `'data'` between consumer pulls and resolves on
 * `'end'`; an `'error'` rejects the in-flight (or next) pull so a mid-stream
 * failure surfaces to the caller instead of silently truncating the pack.
 */
function drainResponse(res: NetResponse): AsyncIterableIterator<Uint8Array> {
  const queue: Uint8Array[] = [];
  let ended = false;
  let error: Error | null = null;
  let wake: (() => void) | null = null;

  const signal = (): void => {
    const w = wake;
    wake = null;
    w?.();
  };

  res.on('data', (chunk) => {
    queue.push(chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk));
    signal();
  });
  res.on('end', () => {
    ended = true;
    signal();
  });
  res.on('error', (err) => {
    error = err;
    signal();
  });

  return (async function* generate(): AsyncIterableIterator<Uint8Array> {
    for (;;) {
      while (queue.length > 0) {
        const chunk = queue.shift();
        if (chunk !== undefined) yield chunk;
      }
      if (error !== null) throw error;
      if (ended) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  })();
}

/**
 * Build the isomorphic-git http plugin. `opts.request` injects an alternate net
 * `request` (the network boundary) for tests; default is the real one.
 */
/** The isomorphic-git `http` plugin shape {@link riftyGitHttp} returns. */
export type GitHttp = ReturnType<typeof riftyGitHttp>;

export function riftyGitHttp(opts: { request?: typeof netRequest } = {}): {
  request: (req: GitHttpRequest) => Promise<GitHttpResponse>;
} {
  const doRequest = opts.request ?? netRequest;

  return {
    request(req: GitHttpRequest): Promise<GitHttpResponse> {
      return new Promise<GitHttpResponse>((resolve, reject) => {
        const method = req.method ?? 'GET';
        const clientReq = doRequest(req.url, { method, headers: req.headers ?? {} });

        let settled = false;
        const fail = (err: Error): void => {
          if (settled) return;
          settled = true;
          reject(err);
        };

        clientReq.on('error', (err) => fail(err as Error));

        clientReq.on('response', (resArg) => {
          if (settled) return;
          settled = true;
          const res = resArg as NetResponse;
          resolve({
            url: req.url,
            method,
            statusCode: res.statusCode,
            statusMessage: res.statusMessage,
            headers: res.headers,
            body: drainResponse(res),
          });
        });

        if (req.signal) {
          const onAbort = (): void => {
            clientReq.abort();
            fail(new DOMException('The operation was aborted.', 'AbortError'));
          };
          if (req.signal.aborted) onAbort();
          else req.signal.addEventListener('abort', onAbort, { once: true });
        }

        // Stream the outgoing body, then end. Errors while draining the body
        // iterable abort the net request and reject.
        void (async (): Promise<void> => {
          try {
            if (req.body) {
              for await (const chunk of req.body) {
                clientReq.write(chunk);
              }
            }
            clientReq.end();
          } catch (err) {
            clientReq.abort();
            fail(err as Error);
          }
        })();
      });
    },
  };
}
