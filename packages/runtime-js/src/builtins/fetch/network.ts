import { type NodeNetworkFetch, NotImplementedError } from '@riftydev/io';
import { ref, unref } from '../../internal/event-loop-keepalive.ts';
import type { BodyState, FetchClasses, RequestState } from './generated/classes.js';
import { installFetchPlatformBindings } from './platform.ts';

const forbiddenHeaders = new Set([
  'accept-charset',
  'accept-encoding',
  'access-control-request-headers',
  'access-control-request-method',
  'connection',
  'content-length',
  'cookie',
  'cookie2',
  'date',
  'dnt',
  'expect',
  'keep-alive',
  'origin',
  'referer',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'user-agent',
  'via',
]);

/** Browser restrictions are an explicit transport ceiling, never header loss. */
function checkTransport(request: RequestState, dispatcher: unknown): void {
  const body = request.body;
  if (body !== null && body.source === null) throw new NotImplementedError('fetch.streamingUpload');
  if (dispatcher !== undefined) throw new NotImplementedError('fetch.dispatcher');
  for (const [originalName, value] of request.headersList.entriesList) {
    const name = originalName.toLowerCase();
    if (
      forbiddenHeaders.has(name) ||
      name.startsWith('proxy-') ||
      name.startsWith('sec-') ||
      (['x-http-method', 'x-http-method-override', 'x-method-override'].includes(name) &&
        /\b(CONNECT|TRACE|TRACK)\b/iu.test(value))
    ) {
      throw new NotImplementedError('fetch.requestHeaders', name);
    }
  }
}

/** Caller cancellation settles even when a guest-supplied Blob stream stalls. */
function uploadBytes(
  body: BodyState,
  signal: AbortSignal,
  classes: FetchClasses,
): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const abort = (): void => {
      signal.removeEventListener('abort', abort);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    classes.fullyReadBody(
      body,
      (bytes) => {
        signal.removeEventListener('abort', abort);
        resolve(bytes);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        reject(error);
      },
    );
  });
}

function networkBody(
  source: ReadableStream<Uint8Array<ArrayBuffer>>,
  signal: AbortSignal,
  release: () => void,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let abort: () => void;
  const stream = new ReadableStream(
    {
      type: 'bytes',
      start(controller) {
        const weakController = new WeakRef(controller);
        const weakReader = new WeakRef(reader);
        abort = () => {
          weakController.deref()?.error(signal.reason);
          void weakReader
            .deref()
            ?.cancel(signal.reason)
            .catch(() => {})
            .finally(release);
          release();
        };
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      },
      async pull(controller) {
        try {
          const { done, value } = await reader.read();
          if (done) {
            controller.close();
            controller.byobRequest?.respond(0);
            release();
          } else controller.enqueue(value);
        } catch (error) {
          controller.error(error);
          release();
        }
      },
      async cancel(reason) {
        signal.removeEventListener('abort', abort);
        try {
          await reader.cancel(reason);
        } finally {
          release();
        }
      },
    },
    { highWaterMark: 65536 },
  );
  installFetchPlatformBindings().trackBody(stream);
  return stream;
}

/** One network body, owned by the JS Response; consumers never get a second view. */
export function createGuestFetch(classes: FetchClasses, nativeFetch: typeof fetch): typeof fetch {
  const dispatcherKey = Symbol.for('undici.globalDispatcher.1');
  const realm = globalThis as typeof globalThis & { [dispatcherKey]?: unknown };
  const hostDispatcher = realm[dispatcherKey];
  const guestFetch = async function fetch(
    input: RequestInfo | URL,
    init: RequestInit | undefined = undefined,
  ): Promise<Response> {
    // biome-ignore lint/style/noArguments: preserve fetch.length=1 and omitted-vs-undefined argument checking.
    classes.argumentLengthCheck(arguments, 1, 'globalThis.fetch');
    const requestObject = new classes.Request(input, init);
    const request = classes.getRequestState(requestObject);
    const signal = requestObject.signal;
    checkTransport(
      request,
      classes.getRequestDispatcher(requestObject) ??
        (realm[dispatcherKey] !== hostDispatcher ? realm[dispatcherKey] : undefined),
    );
    const url = request.urlList[request.urlList.length - 1] as URL;
    return holdNetwork(async (release) => {
      signal.throwIfAborted();
      // HTTP/1 upload streams are not supported by native Chromium fetch.
      // Consume the real JS multipart/body bytes; native never re-encodes them.
      const body =
        request.body === null ? undefined : await uploadBytes(request.body, signal, classes);
      if (request.keepalive && body !== undefined && body.byteLength > 65536) {
        throw new NotImplementedError('fetch.keepalive');
      }
      const response = await nativeFetch(url.href, {
        method: request.method,
        headers: request.headersList.entriesList,
        body,
        signal,
        redirect: request.redirect,
        // Node 24 has no HTTP cache, including force-cache/only-if-cached.
        cache: 'no-store',
        credentials: 'omit',
        integrity: request.integrity,
        keepalive: request.keepalive,
        mode: 'cors',
        referrerPolicy: request.referrerPolicy,
      });
      return responseFromHost(response, url, signal, classes, release);
    });
  };
  Object.defineProperty(guestFetch, 'name', { value: 'fetch', configurable: true });
  return guestFetch;
}

/** The same lifetime owner serves Fetch and the existing native HTTP egress. */
function holdNetwork(run: (release: () => void) => Promise<Response>): Promise<Response> {
  ref();
  let released = false;
  const release = (): void => {
    if (!released) {
      released = true;
      unref();
    }
  };
  return run(release).catch((error) => {
    release();
    throw error;
  });
}

function responseFromHost(
  response: Response,
  url: URL,
  signal: AbortSignal,
  classes: FetchClasses,
  release: () => void,
): Response {
  if (response.type === 'opaque' || response.type === 'opaqueredirect')
    throw new NotImplementedError('fetch.opaqueResponse');
  const stream = response.body === null ? null : networkBody(response.body, signal, release);
  if (stream === null) release();
  return classes.fromInnerResponse(
    classes.makeResponse({
      type: 'basic',
      status: response.status,
      statusText: response.statusText,
      urlList: response.redirected ? [url, new URL(response.url)] : [new URL(response.url)],
      headersList: classes.getHeadersList(new classes.Headers(response.headers)),
      body: stream === null ? null : { stream, source: null, length: null },
    }),
    'immutable',
  );
}

/** Preserve ADR-0181's native streaming HTTP transport, sharing only the body/ref owner. */
export function createNodeNetworkFetch(
  classes: FetchClasses,
  nativeFetch: typeof fetch,
): NodeNetworkFetch {
  return (url, init) =>
    holdNetwork(async (release) =>
      responseFromHost(
        await nativeFetch(url, init),
        new URL(url),
        init.signal ?? new AbortController().signal,
        classes,
        release,
      ),
    );
}
