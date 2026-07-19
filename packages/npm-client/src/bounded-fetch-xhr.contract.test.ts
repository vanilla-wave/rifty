import { afterEach, describe, expect, it, vi } from 'vitest';
import { EDDY_STORE_DURABLE_HEADER } from './eddy-request.ts';
import {
  assetFixture,
  eddyBundleFixture,
  realStandardSource,
  responseForBundle,
} from './eddy-shadow-asset-source.test-support.ts';
import { createEddyShadowAssetSource } from './eddy-shadow-asset-source.ts';

interface RequestBodyBounds {
  readonly stallTimeoutMs?: number;
  readonly maxBytes?: number;
  readonly label?: string;
}

interface BoundedBodyRequest {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly body?: string;
  readonly signal: AbortSignal;
}

interface BoundedBodyResult {
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly bytes: Uint8Array;
}

type RequestBodyBounded = (
  request: BoundedBodyRequest,
  bounds?: RequestBodyBounds,
  fetchImpl?: typeof fetch,
) => Promise<BoundedBodyResult>;

async function requestBodyBounded(
  request: BoundedBodyRequest,
  bounds: RequestBodyBounds = {},
  fetchImpl?: typeof fetch,
): Promise<BoundedBodyResult> {
  const module = (await import('./bounded-fetch.ts')) as unknown as Record<string, unknown>;
  const operation = module.requestBodyBounded;
  if (typeof operation !== 'function') {
    throw new TypeError('bounded-fetch requestBodyBounded is not implemented');
  }
  return (operation as RequestBodyBounded)(request, bounds, fetchImpl);
}

function bodyRequest(overrides: Partial<BoundedBodyRequest> = {}): BoundedBodyRequest {
  return {
    url: 'https://eddy.test/resolve',
    method: 'GET',
    signal: new AbortController().signal,
    ...overrides,
  };
}

type FakeXhrScenario = (xhr: FakeXmlHttpRequest) => void;

class FakeXmlHttpRequest {
  static constructs = 0;
  static scenario: FakeXhrScenario | null = null;

  static reset(): void {
    FakeXmlHttpRequest.constructs = 0;
    FakeXmlHttpRequest.scenario = null;
  }

  readonly requestHeaders = new Headers();
  abortCalls = 0;
  method = '';
  url = '';
  sentBody: unknown;
  readyState = 0;
  response: ArrayBuffer | null = null;
  responseType: XMLHttpRequestResponseType = '';
  status = 0;
  statusText = '';
  timeout = 0;
  withCredentials = false;
  onabort: ((event: ProgressEvent<XMLHttpRequestEventTarget>) => unknown) | null = null;
  onerror: ((event: ProgressEvent<XMLHttpRequestEventTarget>) => unknown) | null = null;
  onload: ((event: ProgressEvent<XMLHttpRequestEventTarget>) => unknown) | null = null;
  onprogress: ((event: ProgressEvent<XMLHttpRequestEventTarget>) => unknown) | null = null;
  onreadystatechange: ((event: Event) => unknown) | null = null;
  ontimeout: ((event: ProgressEvent<XMLHttpRequestEventTarget>) => unknown) | null = null;
  #aborted = false;
  #responseHeaders = '';
  readonly #listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  constructor() {
    FakeXmlHttpRequest.constructs += 1;
  }

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
    this.readyState = 1;
  }

  setRequestHeader(name: string, value: string): void {
    this.requestHeaders.append(name, value);
  }

  getAllResponseHeaders(): string {
    return this.#responseHeaders;
  }

  getResponseHeader(name: string): string | null {
    const headers = new Headers();
    for (const line of this.#responseHeaders.split('\r\n').filter(Boolean)) {
      const separator = line.indexOf(':');
      headers.append(line.slice(0, separator), line.slice(separator + 1).trim());
    }
    return headers.get(name);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (listener === null) return;
    const listeners = this.#listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (listener !== null) this.#listeners.get(type)?.delete(listener);
  }

  send(body?: unknown): void {
    this.sentBody = body;
    const scenario = FakeXmlHttpRequest.scenario;
    if (scenario === null) throw new Error('FakeXmlHttpRequest scenario is not configured');
    scenario(this);
  }

  abort(): void {
    if (this.#aborted) return;
    this.#aborted = true;
    this.abortCalls += 1;
    this.#emit('abort');
  }

  emitHeaders(
    status = 200,
    headers = 'content-type: application/octet-stream\r\n',
    statusText = 'OK',
  ): void {
    if (this.#aborted) return;
    this.status = status;
    this.statusText = statusText;
    this.#responseHeaders = headers;
    this.readyState = 2;
    this.#emit('readystatechange');
  }

  emitProgress(loaded: number, total = 0, lengthComputable = false): void {
    if (this.#aborted) return;
    this.#emit('progress', { lengthComputable, loaded, total });
  }

  emitLoad(bytes: Uint8Array): void {
    if (this.#aborted) return;
    this.response = bytes.slice().buffer;
    this.readyState = 4;
    this.#emit('readystatechange');
    this.#emit('load');
  }

  emitError(): void {
    if (!this.#aborted) this.#emit('error');
  }

  #emit(type: string, fields: Readonly<Record<string, unknown>> = {}): void {
    const event = Object.assign(new Event(type), fields);
    if (type === 'readystatechange') this.onreadystatechange?.(event);
    else {
      const progress = event as unknown as ProgressEvent<XMLHttpRequestEventTarget>;
      if (type === 'abort') this.onabort?.(progress);
      if (type === 'error') this.onerror?.(progress);
      if (type === 'load') this.onload?.(progress);
      if (type === 'progress') this.onprogress?.(progress);
      if (type === 'timeout') this.ontimeout?.(progress);
    }
    for (const listener of this.#listeners.get(type) ?? []) {
      if (typeof listener === 'function') listener(event);
      else listener.handleEvent(event);
    }
  }
}

function installXhr(scenario: FakeXhrScenario): void {
  FakeXmlHttpRequest.scenario = scenario;
  vi.stubGlobal('XMLHttpRequest', FakeXmlHttpRequest);
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeXmlHttpRequest.reset();
});

describe('bounded full-body browser request contract', () => {
  it('returns exact native-load status, headers, and ArrayBuffer bytes', async () => {
    const body = Uint8Array.from([0, 1, 2, 255]);
    let xhr: FakeXmlHttpRequest | undefined;
    installXhr((value) => {
      xhr = value;
      value.emitHeaders(
        206,
        'content-type: application/x-tar\r\nx-proof: exact\r\n',
        'Partial Content',
      );
      value.emitProgress(body.byteLength);
      value.emitLoad(body);
    });

    const result = await requestBodyBounded(bodyRequest({ method: 'POST', body: '{}' }), {
      stallTimeoutMs: 25,
      maxBytes: 64,
      label: 'exact XHR',
    });

    expect(result.status).toBe(206);
    expect(result.statusText).toBe('Partial Content');
    expect(result.headers.get('content-type')).toBe('application/x-tar');
    expect(result.headers.get('x-proof')).toBe('exact');
    expect([...result.bytes]).toEqual([...body]);
    expect(xhr).toMatchObject({ method: 'POST', url: 'https://eddy.test/resolve' });
    expect(xhr?.sentBody).toBe('{}');
    expect(xhr?.responseType).toBe('arraybuffer');
  });

  it('uses monotonic safe progress.loaded and never trusts total or lengthComputable', async () => {
    const body = Uint8Array.from([1, 2, 3, 4]);
    installXhr((xhr) => {
      xhr.emitHeaders();
      xhr.emitProgress(2, Number.MAX_SAFE_INTEGER, true);
      xhr.emitProgress(4, Number.MAX_SAFE_INTEGER, true);
      xhr.emitLoad(body);
    });

    await expect(
      requestBodyBounded(bodyRequest(), { maxBytes: 4, stallTimeoutMs: 25 }),
    ).resolves.toMatchObject({ status: 200, bytes: body });
  });

  it('retains a non-2xx response body for the caller to classify', async () => {
    const body = new TextEncoder().encode('typed service failure');
    installXhr((xhr) => {
      xhr.emitHeaders(
        503,
        'content-type: application/json\r\nx-failure: retained\r\n',
        'Service Unavailable',
      );
      xhr.emitProgress(body.byteLength);
      xhr.emitLoad(body);
    });

    await expect(
      requestBodyBounded(bodyRequest({ method: 'POST', body: '{}' }), {
        maxBytes: body.byteLength,
        stallTimeoutMs: 25,
      }),
    ).resolves.toMatchObject({
      status: 503,
      statusText: 'Service Unavailable',
      bytes: body,
    });
  });

  it('rejects a header stall and aborts the native request', async () => {
    vi.useFakeTimers();
    let xhr: FakeXmlHttpRequest | undefined;
    installXhr((value) => {
      xhr = value;
    });
    const pending = requestBodyBounded(bodyRequest(), {
      stallTimeoutMs: 25,
      label: 'header-stall XHR',
    });
    void pending.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(26);
    await expect(pending).rejects.toThrow(/header-stall XHR.*headers.*25ms/i);
    expect(xhr?.abortCalls).toBe(1);
  });

  it('rejects a mid-body stall and aborts the native request', async () => {
    vi.useFakeTimers();
    let xhr: FakeXmlHttpRequest | undefined;
    installXhr((value) => {
      xhr = value;
      value.emitHeaders();
      value.emitProgress(2);
    });
    const pending = requestBodyBounded(bodyRequest(), {
      stallTimeoutMs: 25,
      label: 'body-stall XHR',
    });
    void pending.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(26);
    await expect(pending).rejects.toThrow(/body-stall XHR.*body progress.*25ms/i);
    expect(xhr?.abortCalls).toBe(1);
  });

  it.each([
    [
      'duplicate loaded',
      (xhr: FakeXmlHttpRequest) => {
        xhr.emitProgress(1);
        setTimeout(() => xhr.emitProgress(1), 20);
      },
    ],
    [
      'zero loaded',
      (xhr: FakeXmlHttpRequest) => {
        xhr.emitProgress(0);
        setTimeout(() => xhr.emitProgress(0), 20);
      },
    ],
  ])('does not reset the body-stall bound for %s events', async (_label, emitNoProgress) => {
    vi.useFakeTimers();
    let xhr: FakeXmlHttpRequest | undefined;
    installXhr((value) => {
      xhr = value;
      value.emitHeaders();
      emitNoProgress(value);
    });
    const pending = requestBodyBounded(bodyRequest(), {
      stallTimeoutMs: 25,
      label: 'no-progress XHR',
    });
    void pending.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(26);
    await expect(pending).rejects.toThrow(/no-progress XHR.*body progress.*25ms/i);
    expect(xhr?.abortCalls).toBe(1);
  });

  it('resets the no-progress bound for a slow body that keeps advancing', async () => {
    vi.useFakeTimers();
    const body = Uint8Array.from([1, 2, 3]);
    installXhr((xhr) => {
      setTimeout(() => xhr.emitHeaders(), 5);
      setTimeout(() => xhr.emitProgress(1), 20);
      setTimeout(() => xhr.emitProgress(2), 40);
      setTimeout(() => xhr.emitProgress(3), 60);
      setTimeout(() => xhr.emitLoad(body), 65);
    });
    const pending = requestBodyBounded(bodyRequest(), {
      stallTimeoutMs: 25,
      maxBytes: 3,
    });
    void pending.catch(() => undefined);

    await vi.advanceTimersByTimeAsync(70);
    await expect(pending).resolves.toMatchObject({ bytes: body });
  });

  it('aborts immediately when progress.loaded exceeds the byte cap', async () => {
    let xhr: FakeXmlHttpRequest | undefined;
    installXhr((value) => {
      xhr = value;
      value.emitHeaders();
      value.emitProgress(5, 0, false);
    });

    await expect(
      requestBodyBounded(bodyRequest(), { maxBytes: 4, stallTimeoutMs: 25 }),
    ).rejects.toThrow(/exceeded 4 bytes/i);
    expect(xhr?.abortCalls).toBe(1);
  });

  it('propagates external abort and aborts the native request', async () => {
    const controller = new AbortController();
    let xhr: FakeXmlHttpRequest | undefined;
    installXhr((value) => {
      xhr = value;
      value.emitHeaders();
    });
    const pending = requestBodyBounded(bodyRequest({ signal: controller.signal }), {
      stallTimeoutMs: 25,
    });

    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(xhr?.abortCalls).toBe(1);
  });

  it('rejects a pre-aborted signal without constructing a native request', async () => {
    const controller = new AbortController();
    controller.abort();
    installXhr(() => {
      throw new Error('pre-aborted request reached XMLHttpRequest');
    });

    await expect(
      requestBodyBounded(bodyRequest({ signal: controller.signal }), { stallTimeoutMs: 25 }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(FakeXmlHttpRequest.constructs).toBe(0);
  });

  it('rejects a native network error loudly', async () => {
    installXhr((xhr) => {
      xhr.emitHeaders();
      xhr.emitError();
    });

    await expect(requestBodyBounded(bodyRequest(), { label: 'network XHR' })).rejects.toThrow(
      /network XHR.*network/i,
    );
  });

  it.each([
    [
      'non-monotonic loaded',
      (xhr: FakeXmlHttpRequest) => {
        xhr.emitHeaders();
        xhr.emitProgress(4);
        xhr.emitProgress(3);
      },
      /monotonic/i,
    ],
    [
      'unsafe loaded',
      (xhr: FakeXmlHttpRequest) => {
        xhr.emitHeaders();
        xhr.emitProgress(Number.MAX_SAFE_INTEGER + 1);
      },
      /safe integer/i,
    ],
    [
      'final byte mismatch',
      (xhr: FakeXmlHttpRequest) => {
        xhr.emitHeaders();
        xhr.emitProgress(5);
        xhr.emitLoad(Uint8Array.from([1, 2, 3, 4]));
      },
      /final|mismatch|progress/i,
    ],
  ])('rejects corrupt XHR accounting: %s', async (_label, scenario, pattern) => {
    installXhr(scenario);
    await expect(
      requestBodyBounded(bodyRequest(), {
        maxBytes: Number.MAX_SAFE_INTEGER,
        stallTimeoutMs: 25,
      }),
    ).rejects.toThrow(pattern);
  });

  it.each([
    [
      'absent progress',
      (xhr: FakeXmlHttpRequest) => {
        xhr.emitHeaders();
        xhr.emitLoad(Uint8Array.from([1, 2, 3, 4, 5]));
      },
    ],
    [
      'lying progress',
      (xhr: FakeXmlHttpRequest) => {
        xhr.emitHeaders();
        xhr.emitProgress(4);
        xhr.emitLoad(Uint8Array.from([1, 2, 3, 4, 5]));
      },
    ],
  ])('rejects a final body over cap with %s', async (_label, scenario) => {
    installXhr(scenario);
    await expect(
      requestBodyBounded(bodyRequest(), { maxBytes: 4, stallTimeoutMs: 25 }),
    ).rejects.toThrow(/exceeded 4 bytes/i);
  });

  it('keeps an explicit custom fetchImpl on the existing fetch path', async () => {
    installXhr(() => {
      throw new Error('custom fetch path constructed XMLHttpRequest');
    });
    const fetchImpl = vi.fn(
      async () =>
        new Response(Uint8Array.from([4, 5, 6]), {
          status: 201,
          headers: { 'x-path': 'custom-fetch' },
        }),
    );

    await expect(
      requestBodyBounded(bodyRequest(), { stallTimeoutMs: 25 }, fetchImpl),
    ).resolves.toMatchObject({
      status: 201,
      bytes: Uint8Array.from([4, 5, 6]),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(FakeXmlHttpRequest.constructs).toBe(0);
  });

  it('keeps the fetch path when XMLHttpRequest is unavailable', async () => {
    vi.stubGlobal('XMLHttpRequest', undefined);
    const fetchImpl = vi.fn(
      async () => new Response(Uint8Array.from([7, 8]), { headers: { 'x-path': 'global-fetch' } }),
    );
    vi.stubGlobal('fetch', fetchImpl);

    await expect(requestBodyBounded(bodyRequest(), { stallTimeoutMs: 25 })).resolves.toMatchObject({
      bytes: Uint8Array.from([7, 8]),
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('Eddy default browser full-body selection', () => {
  it('uses native XHR for the default browser transport', async () => {
    const asset = await assetFixture();
    const bundle = await eddyBundleFixture([asset]);
    const standard = realStandardSource(asset);
    let xhr: FakeXmlHttpRequest | undefined;
    installXhr((value) => {
      xhr = value;
      value.emitHeaders(
        200,
        `content-type: application/x-tar\r\n${EDDY_STORE_DURABLE_HEADER}: 1\r\n`,
      );
      value.emitProgress(bundle.bytes.byteLength, 0, false);
      value.emitLoad(bundle.bytes);
    });
    const defaultFetch = vi.fn(async () => responseForBundle(bundle, true));
    vi.stubGlobal('fetch', defaultFetch);
    const source = createEddyShadowAssetSource({
      resolverUrl: 'https://eddy.test/resolve',
      sourceRequests: [asset.request],
      standardSource: standard.source,
      learnedPins: new Map(),
    });

    await expect(
      source.acquire([asset.request], { signal: new AbortController().signal }),
    ).resolves.toEqual([expect.objectContaining({ fillTransport: 'eddy', fillCache: 'bundle' })]);
    expect(defaultFetch).not.toHaveBeenCalled();
    expect(FakeXmlHttpRequest.constructs).toBe(1);
    expect(xhr).toMatchObject({
      method: 'POST',
      url: 'https://eddy.test/resolve',
      sentBody: '{"dependencies":{"esbuild-wasm":"0.28.0"},"optionalDependencies":{}}',
    });
    expect(standard.calls).toEqual([]);
  });

  it('keeps Eddy on an explicit custom fetchImpl even when XHR exists', async () => {
    const asset = await assetFixture();
    const bundle = await eddyBundleFixture([asset]);
    const standard = realStandardSource(asset);
    installXhr(() => {
      throw new Error('explicit Eddy fetchImpl constructed XMLHttpRequest');
    });
    const fetchImpl = vi.fn(async () => responseForBundle(bundle, true));
    const source = createEddyShadowAssetSource({
      resolverUrl: 'https://eddy.test/resolve',
      sourceRequests: [asset.request],
      standardSource: standard.source,
      learnedPins: new Map(),
      fetchImpl,
    });

    await expect(
      source.acquire([asset.request], { signal: new AbortController().signal }),
    ).resolves.toEqual([expect.objectContaining({ fillTransport: 'eddy', fillCache: 'bundle' })]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(FakeXmlHttpRequest.constructs).toBe(0);
    expect(standard.calls).toEqual([]);
  });
});
