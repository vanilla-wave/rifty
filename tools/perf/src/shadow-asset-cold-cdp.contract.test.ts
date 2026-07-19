import { describe, expect, it } from 'vitest';
import {
  describeCapturedResponseLedger,
  finalizeStandardAssetSourceResponses,
  startCdpResponseRecorder,
} from './shadow-asset-cold-cdp.mjs';

type CdpHandler = (event: Record<string, unknown>) => void;

class FakeCdpSession {
  readonly calls: Array<{ readonly method: string; readonly params?: Record<string, unknown> }> =
    [];
  readonly bodies = new Map<
    string,
    | { readonly body: string; readonly base64Encoded: boolean }
    | Error
    | Promise<{ readonly body: string; readonly base64Encoded: boolean }>
  >();
  readonly streams = new Map<
    string,
    { readonly bufferedData: string } | Error | Array<{ readonly bufferedData: string } | Error>
  >();
  readonly #handlers = new Map<string, Set<CdpHandler>>();

  on(event: string, handler: CdpHandler) {
    const handlers = this.#handlers.get(event) ?? new Set<CdpHandler>();
    handlers.add(handler);
    this.#handlers.set(event, handlers);
  }

  off(event: string, handler: CdpHandler) {
    this.#handlers.get(event)?.delete(handler);
  }

  emit(event: string, payload: Record<string, unknown>) {
    for (const handler of this.#handlers.get(event) ?? []) handler(payload);
  }

  async send(method: string, params?: Record<string, unknown>) {
    this.calls.push(params === undefined ? { method } : { method, params });
    if (method === 'Network.enable') return {};
    const requestId = String(params?.requestId);
    if (method === 'Network.streamResourceContent') {
      const configured = this.streams.get(requestId);
      const result = Array.isArray(configured) ? configured.shift() : configured;
      if (result instanceof Error) throw result;
      if (result === undefined) throw new Error(`streaming unsupported for ${requestId}`);
      return result;
    }
    if (method !== 'Network.getResponseBody') throw new Error(`unexpected CDP command ${method}`);
    const result = this.bodies.get(requestId);
    if (result instanceof Error) throw result;
    if (result === undefined) throw new Error(`missing body for ${requestId}`);
    return result;
  }

  async detach() {
    this.calls.push({ method: 'detach' });
  }
}

function fakePage(session: FakeCdpSession) {
  return {
    context() {
      return {
        async newCDPSession(target: unknown) {
          expect(target).toBeTruthy();
          return session;
        },
      };
    },
  };
}

function cdpResponse(requestId: string, url: string, overrides: Record<string, unknown> = {}) {
  return {
    requestId,
    response: {
      url,
      status: 200,
      protocol: 'h2',
      fromDiskCache: false,
      fromServiceWorker: false,
      ...overrides,
    },
  };
}

describe('standard shadow-asset CDP response recorder', () => {
  it('drains only selected source lifecycles and follows their redirect request id', async () => {
    const session = new FakeCdpSession();
    const opaqueCdnTarball = 'https://cdn.example/object/abc123';
    session.bodies.set('asset', {
      body: Buffer.from([1, 2, 3]).toString('base64'),
      base64Encoded: true,
    });
    session.bodies.set('unrelated', { body: 'large unrelated package', base64Encoded: false });
    const recorder = await startCdpResponseRecorder(fakePage(session), {
      captureUrl: (url: string) => url.includes('esbuild-wasm'),
    });

    session.emit('Network.requestWillBeSent', {
      requestId: 'unrelated',
      request: { url: `${registryUrl}/vite` },
    });
    session.emit('Network.responseReceived', cdpResponse('unrelated', `${registryUrl}/vite`));
    session.emit('Network.loadingFinished', { requestId: 'unrelated' });
    session.emit('Network.requestWillBeSent', {
      requestId: 'asset',
      request: { url: tarballUrl },
    });
    session.emit('Network.requestWillBeSent', {
      requestId: 'asset',
      request: { url: opaqueCdnTarball },
      redirectResponse: {
        url: tarballUrl,
        status: 302,
        protocol: 'h2',
        fromDiskCache: false,
        fromServiceWorker: false,
      },
    });
    session.emit('Network.responseReceived', cdpResponse('asset', opaqueCdnTarball));
    session.emit('Network.loadingFinished', { requestId: 'asset' });

    const captured = await recorder.stop();
    expect(captured).toEqual([
      expect.objectContaining({ url: tarballUrl, status: 302, complete: false }),
      expect.objectContaining({ url: opaqueCdnTarball, bodyBytes: 3, complete: true }),
    ]);
    expect(session.calls).not.toContainEqual({
      method: 'Network.getResponseBody',
      params: { requestId: 'unrelated' },
    });
  });

  it('enables Network and records exact decoded text and binary response-body bytes', async () => {
    const session = new FakeCdpSession();
    const textStart = '{"name":';
    const textEnd = '"esbuild-wasm"}';
    const text = `${textStart}${textEnd}`;
    const binary = Uint8Array.from([0, 255, 1, 254]);
    session.streams.set('packument', {
      bufferedData: Buffer.from(textStart).toString('base64'),
    });
    session.streams.set('tarball', {
      bufferedData: Buffer.from(binary.slice(0, 2)).toString('base64'),
    });

    const recorder = await startCdpResponseRecorder(fakePage(session));
    session.emit('Network.requestWillBeSent', {
      requestId: 'packument',
      request: { url: packumentUrl, method: 'GET' },
    });
    session.emit('Network.responseReceived', cdpResponse('packument', packumentUrl));
    session.emit('Network.dataReceived', {
      requestId: 'packument',
      dataLength: Buffer.byteLength(textStart),
    });
    await Promise.resolve();
    session.emit('Network.dataReceived', {
      requestId: 'packument',
      dataLength: Buffer.byteLength(textEnd),
      data: Buffer.from(textEnd).toString('base64'),
    });
    session.emit('Network.loadingFinished', { requestId: 'packument' });
    session.emit('Network.requestWillBeSent', {
      requestId: 'tarball',
      request: { url: tarballUrl, method: 'GET' },
    });
    session.emit('Network.responseReceived', cdpResponse('tarball', tarballUrl));
    session.emit('Network.dataReceived', {
      requestId: 'tarball',
      dataLength: 2,
    });
    await Promise.resolve();
    session.emit('Network.dataReceived', {
      requestId: 'tarball',
      dataLength: 2,
      data: Buffer.from(binary.slice(2)).toString('base64'),
    });
    session.emit('Network.loadingFinished', { requestId: 'tarball' });

    await expect(recorder.stop()).resolves.toEqual([
      {
        requestId: 'packument',
        method: 'GET',
        url: packumentUrl,
        status: 200,
        protocol: 'h2',
        bodyBytes: new TextEncoder().encode(text).byteLength,
        bodyText: text,
        complete: true,
        fromDiskCache: false,
        fromServiceWorker: false,
      },
      {
        requestId: 'tarball',
        method: 'GET',
        url: tarballUrl,
        status: 200,
        protocol: 'h2',
        bodyBytes: binary.byteLength,
        complete: true,
        fromDiskCache: false,
        fromServiceWorker: false,
      },
    ]);
    expect(session.calls).toEqual([
      { method: 'Network.enable' },
      { method: 'Network.streamResourceContent', params: { requestId: 'packument' } },
      { method: 'Network.streamResourceContent', params: { requestId: 'tarball' } },
      { method: 'detach' },
    ]);
  });

  it('accepts buffered bytes whose queued dataReceived event omits duplicate data', async () => {
    const session = new FakeCdpSession();
    const buffered = '{"name":"esbuild-wasm"}';
    session.streams.set('buffered-data', {
      bufferedData: Buffer.from(buffered).toString('base64'),
    });
    const recorder = await startCdpResponseRecorder(fakePage(session));

    session.emit('Network.requestWillBeSent', {
      requestId: 'buffered-data',
      request: { url: packumentUrl, method: 'GET' },
    });
    session.emit('Network.responseReceived', cdpResponse('buffered-data', packumentUrl));
    await Promise.resolve();
    await Promise.resolve();
    session.emit('Network.dataReceived', {
      requestId: 'buffered-data',
      dataLength: Buffer.byteLength(buffered),
    });
    session.emit('Network.loadingFinished', { requestId: 'buffered-data' });

    await expect(recorder.stop()).resolves.toEqual([
      expect.objectContaining({
        complete: true,
        bodyBytes: Buffer.byteLength(buffered),
        bodyText: buffered,
      }),
    ]);
  });

  it('refuses when buffered and streamed bytes are smaller than summed dataLength', async () => {
    const session = new FakeCdpSession();
    session.streams.set('missing-data', {
      bufferedData: Buffer.from('abc').toString('base64'),
    });
    session.bodies.set('missing-data', { body: 'hidden fallback', base64Encoded: false });
    const recorder = await startCdpResponseRecorder(fakePage(session));

    session.emit('Network.requestWillBeSent', {
      requestId: 'missing-data',
      request: { url: packumentUrl, method: 'GET' },
    });
    session.emit('Network.responseReceived', cdpResponse('missing-data', packumentUrl));
    await Promise.resolve();
    await Promise.resolve();
    session.emit('Network.dataReceived', { requestId: 'missing-data', dataLength: 4 });
    session.emit('Network.loadingFinished', { requestId: 'missing-data' });

    await expect(recorder.stop()).resolves.toEqual([
      expect.objectContaining({
        complete: false,
        bodyBytes: 0,
        error:
          'Network.streamResourceContent failed: CDP streamed body bytes do not match Network.dataReceived total',
      }),
    ]);
    expect(session.calls).not.toContainEqual({
      method: 'Network.getResponseBody',
      params: { requestId: 'missing-data' },
    });
  });

  it('retries stream setup at responseReceived when requestWillBeSent was too early', async () => {
    const session = new FakeCdpSession();
    const text = '{"name":"esbuild-wasm"}';
    session.streams.set('stream-race', [
      new Error('Request with the provided ID does not exists'),
      { bufferedData: '' },
    ]);
    const recorder = await startCdpResponseRecorder(fakePage(session));

    session.emit('Network.requestWillBeSent', {
      requestId: 'stream-race',
      request: { url: packumentUrl },
    });
    await Promise.resolve();
    await Promise.resolve();
    session.emit('Network.responseReceived', cdpResponse('stream-race', packumentUrl));
    await Promise.resolve();
    await Promise.resolve();
    session.emit('Network.dataReceived', {
      requestId: 'stream-race',
      dataLength: Buffer.byteLength(text),
      data: Buffer.from(text).toString('base64'),
    });
    session.emit('Network.loadingFinished', { requestId: 'stream-race' });

    await expect(recorder.stop()).resolves.toEqual([
      expect.objectContaining({
        complete: true,
        bodyBytes: Buffer.byteLength(text),
        bodyText: text,
      }),
    ]);
    expect(session.calls).toContainEqual({
      method: 'Network.streamResourceContent',
      params: { requestId: 'stream-race' },
    });
    expect(
      session.calls.filter(
        ({ method, params }) =>
          method === 'Network.streamResourceContent' && params?.requestId === 'stream-race',
      ),
    ).toHaveLength(2);
  });

  it('refuses a lifecycle first observed after requestWillBeSent', async () => {
    const session = new FakeCdpSession();
    session.bodies.set('late-attach', { body: '{}', base64Encoded: false });
    const recorder = await startCdpResponseRecorder(fakePage(session));

    session.emit('Network.responseReceived', cdpResponse('late-attach', packumentUrl));
    session.emit('Network.loadingFinished', { requestId: 'late-attach' });

    await expect(recorder.stop()).resolves.toEqual([
      expect.objectContaining({
        requestId: 'late-attach',
        complete: false,
        error: 'response lifecycle began before CDP capture was ready',
      }),
    ]);
  });

  it('records requestServedFromCache and prefetch-cache provenance', async () => {
    const session = new FakeCdpSession();
    session.bodies.set('cached', { body: '{}', base64Encoded: false });
    const recorder = await startCdpResponseRecorder(fakePage(session));

    session.emit('Network.requestWillBeSent', {
      requestId: 'cached',
      request: { url: packumentUrl, method: 'POST' },
    });
    session.emit('Network.requestServedFromCache', { requestId: 'cached' });
    session.emit(
      'Network.responseReceived',
      cdpResponse('cached', packumentUrl, { fromPrefetchCache: true }),
    );
    session.emit('Network.loadingFinished', { requestId: 'cached' });

    await expect(recorder.stop()).resolves.toEqual([
      expect.objectContaining({
        requestId: 'cached',
        method: 'POST',
        requestServedFromCache: true,
        fromPrefetchCache: true,
      }),
    ]);
  });

  it('preserves redirects, retries, loading failures, and body-collection failures in order', async () => {
    const session = new FakeCdpSession();
    session.bodies.set('retry', { body: 'retry body', base64Encoded: false });
    session.bodies.set('body-failure', new Error('No resource with given identifier found'));
    const recorder = await startCdpResponseRecorder(fakePage(session));

    session.emit('Network.requestWillBeSent', {
      requestId: 'redirect',
      request: { url: tarballUrl },
      redirectResponse: {
        url: `${registryUrl}/redirected.tgz`,
        status: 302,
        protocol: 'h2',
        fromDiskCache: false,
        fromServiceWorker: false,
      },
    });
    session.emit('Network.requestWillBeSent', {
      requestId: 'retry',
      request: { url: packumentUrl, method: 'GET' },
    });
    session.emit(
      'Network.responseReceived',
      cdpResponse('retry', packumentUrl, { status: 503, protocol: 'http/1.1' }),
    );
    session.emit('Network.loadingFinished', { requestId: 'retry' });
    session.emit('Network.requestWillBeSent', {
      requestId: 'load-failure',
      request: { url: tarballUrl },
    });
    session.emit('Network.loadingFailed', {
      requestId: 'load-failure',
      errorText: 'net::ERR_CONNECTION_RESET',
      canceled: true,
      blockedReason: 'other',
    });
    session.emit('Network.requestWillBeSent', {
      requestId: 'body-failure',
      request: { url: tarballUrl, method: 'GET' },
    });
    session.emit('Network.responseReceived', cdpResponse('body-failure', tarballUrl));
    session.emit('Network.loadingFinished', { requestId: 'body-failure' });

    const captured = await recorder.stop();
    expect(captured).toEqual([
      expect.objectContaining({
        requestId: 'redirect',
        url: `${registryUrl}/redirected.tgz`,
        status: 302,
        bodyBytes: 0,
        complete: false,
        error: 'redirect response body is unavailable through an unambiguous CDP lifecycle',
      }),
      expect.objectContaining({
        requestId: 'retry',
        url: packumentUrl,
        status: 503,
        protocol: 'http/1.1',
        bodyBytes: new TextEncoder().encode('retry body').byteLength,
        bodyText: 'retry body',
        complete: true,
      }),
      expect.objectContaining({
        requestId: 'load-failure',
        url: tarballUrl,
        status: 0,
        protocol: 'unknown',
        bodyBytes: 0,
        complete: false,
        error: 'Network.loadingFailed: net::ERR_CONNECTION_RESET; canceled; blocked=other',
      }),
      expect.objectContaining({
        requestId: 'body-failure',
        url: tarballUrl,
        bodyBytes: 0,
        complete: false,
        error: 'Network.getResponseBody failed: No resource with given identifier found',
      }),
    ]);
  });

  it('waits for pending getResponseBody work before detaching and makes stop idempotent', async () => {
    const session = new FakeCdpSession();
    let resolveBody:
      | ((value: { readonly body: string; readonly base64Encoded: boolean }) => void)
      | undefined;
    session.bodies.set(
      'pending',
      new Promise((resolve) => {
        resolveBody = resolve;
      }),
    );
    const recorder = await startCdpResponseRecorder(fakePage(session));
    session.emit('Network.responseReceived', cdpResponse('pending', packumentUrl));
    session.emit('Network.loadingFinished', { requestId: 'pending' });

    const firstStop = recorder.stop();
    const secondStop = recorder.stop();
    await Promise.resolve();
    expect(session.calls).toEqual([
      { method: 'Network.enable' },
      { method: 'Network.streamResourceContent', params: { requestId: 'pending' } },
    ]);

    resolveBody?.({ body: '{}', base64Encoded: false });
    await expect(firstStop).resolves.toEqual(await secondStop);
    expect(session.calls).toContainEqual({
      method: 'Network.getResponseBody',
      params: { requestId: 'pending' },
    });
    expect(session.calls.at(-1)).toEqual({ method: 'detach' });
    expect(session.calls.filter(({ method }) => method === 'detach')).toHaveLength(1);
  });
});

const registryUrl = 'https://registry.example/npm-registry';
const source = Object.freeze({
  name: 'esbuild-wasm',
  version: '0.28.0',
  integrity: 'sha512-exact',
});
const packumentUrl = `${registryUrl}/${source.name}`;
const tarballUrl = `${registryUrl}/-/esbuild-wasm-0.28.0.tgz`;

describe('bounded shadow-asset CDP ledger diagnostics', () => {
  it('exposes bounded lifecycle metadata without response-body contents', () => {
    const captured = Array.from({ length: 12 }, (_, index) => ({
      requestId: `request-${index}`,
      lifecycleId: `target-${index}\u0000request-${index}`,
      method: index === 0 ? 'POST' : 'GET',
      url: `${registryUrl}/asset-${index}`,
      status: index === 0 ? 503 : 200,
      protocol: 'h2',
      bodyBytes: index,
      bodyText: 'SECRET RESPONSE BODY',
      complete: index !== 0,
      fromDiskCache: false,
      fromServiceWorker: false,
      error: index === 0 ? `body failed ${'x'.repeat(1_000)}` : undefined,
    }));

    const diagnostic = describeCapturedResponseLedger(captured);

    expect(diagnostic).toContain('captured=12; shown=8');
    expect(diagnostic).toContain('"method":"POST"');
    expect(diagnostic).toContain('"complete":false');
    expect(diagnostic).toContain('body failed');
    expect(diagnostic).toContain('omitted=4');
    expect(diagnostic).not.toContain('SECRET RESPONSE BODY');
    expect(diagnostic.length).toBeLessThanOrEqual(4_096);
  });
});

function packumentBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    name: source.name,
    versions: {
      [source.version]: {
        name: source.name,
        version: source.version,
        dist: { tarball: tarballUrl, integrity: source.integrity },
      },
    },
    ...overrides,
  });
}

function response(url: string, body: string | Uint8Array, overrides: Record<string, unknown> = {}) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return {
    requestId: `request-${Math.random()}`,
    url,
    method: 'GET',
    status: 200,
    protocol: 'h2',
    bodyBytes: bytes.byteLength,
    bodyText: typeof body === 'string' ? body : undefined,
    complete: true,
    fromDiskCache: false,
    fromServiceWorker: false,
    ...overrides,
  };
}

describe('standard shadow-asset CDP response finalization', () => {
  it('classifies only the exact packument and integrity-proven tarball', () => {
    const body = packumentBody();
    const result = finalizeStandardAssetSourceResponses({
      registryUrl,
      source,
      captured: [response(tarballUrl, new Uint8Array([1, 2, 3])), response(packumentUrl, body)],
    });

    expect(result).toEqual({
      ok: true,
      sourceResponses: [
        {
          source: 'tarball',
          url: tarballUrl,
          method: 'GET',
          protocol: 'h2',
          bodyBytes: 3,
          complete: true,
          fromDiskCache: false,
          fromServiceWorker: false,
        },
        {
          source: 'packument',
          url: packumentUrl,
          method: 'GET',
          protocol: 'h2',
          bodyBytes: new TextEncoder().encode(body).byteLength,
          complete: true,
          fromDiskCache: false,
          fromServiceWorker: false,
        },
      ],
    });
  });

  it.each([
    ['non-2xx', { status: 404 }],
    ['incomplete', { complete: false, bodyBytes: 0 }],
  ])('rejects %s exact tarball evidence', (_label, overrides) => {
    const result = finalizeStandardAssetSourceResponses({
      registryUrl,
      source,
      captured: [
        response(packumentUrl, packumentBody()),
        response(tarballUrl, new Uint8Array([1, 2, 3]), overrides),
      ],
    });

    expect(result).toEqual({
      ok: false,
      note: 'esbuild-wasm@0.28.0 has no complete successful 2xx exact tarball response',
    });
  });

  it.each(['dist URL', 'configured proxy mapping'])(
    'accepts the exact tarball at its %s while preserving pathname and query',
    (candidate) => {
      const upstream = 'https://upstream.example/esbuild-wasm/-/esbuild-wasm-0.28.0.tgz?download=1';
      const proxied = `${registryUrl}/esbuild-wasm/-/esbuild-wasm-0.28.0.tgz?download=1`;
      const body = packumentBody({
        versions: {
          [source.version]: {
            name: source.name,
            version: source.version,
            dist: { tarball: upstream, integrity: source.integrity },
          },
        },
      });
      const selected = candidate === 'dist URL' ? upstream : proxied;

      const result = finalizeStandardAssetSourceResponses({
        registryUrl,
        source,
        captured: [response(packumentUrl, body), response(selected, new Uint8Array([1, 2, 3]))],
      });

      expect(result).toMatchObject({ ok: true });
      if (!result.ok) return;
      expect(result.sourceResponses.at(-1)).toMatchObject({
        source: 'tarball',
        url: selected,
      });
    },
  );

  it('rejects a proxy candidate with the wrong path or query', () => {
    const upstream = 'https://upstream.example/esbuild-wasm/-/esbuild-wasm-0.28.0.tgz?download=1';
    const body = packumentBody({
      versions: {
        [source.version]: {
          dist: { tarball: upstream, integrity: source.integrity },
        },
      },
    });

    for (const wrong of [
      `${registryUrl}/other/-/esbuild-wasm-0.28.0.tgz?download=1`,
      `${registryUrl}/esbuild-wasm/-/esbuild-wasm-0.28.0.tgz?download=2`,
    ]) {
      expect(
        finalizeStandardAssetSourceResponses({
          registryUrl,
          source,
          captured: [response(packumentUrl, body), response(wrong, new Uint8Array([1]))],
        }),
      ).toEqual({
        ok: false,
        note: 'esbuild-wasm@0.28.0 has no exact tarball response',
      });
    }
  });

  it('rejects multiple direct/proxy tarball candidates instead of choosing one', () => {
    const upstream = 'https://upstream.example/esbuild-wasm/-/esbuild-wasm-0.28.0.tgz';
    const proxied = `${registryUrl}/esbuild-wasm/-/esbuild-wasm-0.28.0.tgz`;
    const body = packumentBody({
      versions: {
        [source.version]: {
          dist: { tarball: upstream, integrity: source.integrity },
        },
      },
    });

    expect(
      finalizeStandardAssetSourceResponses({
        registryUrl,
        source,
        captured: [
          response(packumentUrl, body),
          response(upstream, new Uint8Array([1])),
          response(proxied, new Uint8Array([1])),
        ],
      }),
    ).toEqual({
      ok: false,
      note: 'esbuild-wasm@0.28.0 matched multiple tarball source candidates',
    });
  });

  it('retains a tracked redirect lifecycle whose URL leaves the exact tarball', () => {
    const requestId = 'tarball-redirect';
    const redirectUrl = 'https://cdn.example/opaque/retry';
    const result = finalizeStandardAssetSourceResponses({
      registryUrl,
      source,
      captured: [
        response(packumentUrl, packumentBody()),
        response(redirectUrl, new Uint8Array(), {
          requestId,
          status: 302,
          complete: false,
          bodyBytes: 0,
        }),
        response(tarballUrl, new Uint8Array([1, 2, 3]), { requestId }),
      ],
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.sourceResponses.map(({ source: kind, url }) => [kind, url])).toEqual([
      ['packument', packumentUrl],
      ['tarball', redirectUrl],
      ['tarball', tarballUrl],
    ]);
  });

  it('refuses a captured lifecycle that cannot be classified without guessing', () => {
    const unclassifiedUrl = 'https://registry.example/npm-registry/vite';
    const result = finalizeStandardAssetSourceResponses({
      registryUrl,
      source,
      captured: [
        response(packumentUrl, packumentBody()),
        response(tarballUrl, new Uint8Array([1])),
        response(unclassifiedUrl, '{}'),
      ],
    });

    expect(result).toEqual({
      ok: false,
      note: `esbuild-wasm@0.28.0 has unclassified captured response lifecycle ${unclassifiedUrl}`,
    });
  });

  it.each([
    [
      'Network.requestServedFromCache',
      { requestServedFromCache: true },
      'Network.requestServedFromCache',
    ],
    ['response.fromPrefetchCache', { fromPrefetchCache: true }, 'response.fromPrefetchCache'],
  ])('refuses %s source provenance', (_label, overrides, signal) => {
    const result = finalizeStandardAssetSourceResponses({
      registryUrl,
      source,
      captured: [
        response(packumentUrl, packumentBody()),
        response(tarballUrl, new Uint8Array([1]), overrides),
      ],
    });

    expect(result).toEqual({
      ok: false,
      note: `esbuild-wasm@0.28.0 tarball response was served from cache (${signal})`,
    });
  });

  it('retains every retry body so total response bytes cannot hide failed attempts', () => {
    const retry = response(packumentUrl, '{"error":"again"}', { status: 503 });
    const successful = response(packumentUrl, packumentBody());
    const tarball = response(tarballUrl, new Uint8Array([1, 2, 3, 4]));

    const result = finalizeStandardAssetSourceResponses({
      registryUrl,
      source,
      captured: [retry, successful, tarball],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sourceResponses.map(({ source: kind, bodyBytes }) => [kind, bodyBytes])).toEqual([
      ['packument', retry.bodyBytes],
      ['packument', successful.bodyBytes],
      ['tarball', 4],
    ]);
  });

  it('keeps incomplete redirect/body evidence loud for whole-row refusal', () => {
    const result = finalizeStandardAssetSourceResponses({
      registryUrl,
      source,
      captured: [
        response(packumentUrl, packumentBody()),
        response(tarballUrl, new Uint8Array(), {
          status: 302,
          complete: false,
          bodyBytes: 0,
          bodyText: undefined,
        }),
        response(tarballUrl, new Uint8Array([1, 2, 3])),
      ],
    });

    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.sourceResponses).toHaveLength(3);
    expect(result.sourceResponses[1]).toMatchObject({
      source: 'tarball',
      complete: false,
      bodyBytes: 0,
    });
  });

  it('rejects a successful packument whose exact version changes source integrity', () => {
    const result = finalizeStandardAssetSourceResponses({
      registryUrl,
      source,
      captured: [
        response(
          packumentUrl,
          packumentBody({
            versions: {
              [source.version]: {
                dist: { tarball: tarballUrl, integrity: 'sha512-different' },
              },
            },
          }),
        ),
        response(tarballUrl, new Uint8Array([1])),
      ],
    });

    expect(result).toEqual({
      ok: false,
      note: 'esbuild-wasm@0.28.0 packument integrity does not match the canonical source',
    });
  });

  it('rejects malformed or byte-inconsistent successful packument evidence', () => {
    expect(
      finalizeStandardAssetSourceResponses({
        registryUrl,
        source,
        captured: [response(packumentUrl, '{not json')],
      }),
    ).toEqual({
      ok: false,
      note: 'esbuild-wasm@0.28.0 packument response is not valid JSON',
    });

    expect(
      finalizeStandardAssetSourceResponses({
        registryUrl,
        source,
        captured: [response(packumentUrl, packumentBody(), { bodyBytes: 1 })],
      }),
    ).toEqual({
      ok: false,
      note: 'esbuild-wasm@0.28.0 decoded packument byte evidence is inconsistent',
    });
  });

  it('rejects missing exact source responses and conflicting tarball URLs', () => {
    expect(finalizeStandardAssetSourceResponses({ registryUrl, source, captured: [] })).toEqual({
      ok: false,
      note: 'esbuild-wasm@0.28.0 has no exact standard packument response',
    });

    const otherTarball = `${registryUrl}/-/other-esbuild-wasm-0.28.0.tgz`;
    const first = response(packumentUrl, packumentBody());
    const second = response(
      packumentUrl,
      packumentBody({
        versions: {
          [source.version]: {
            dist: { tarball: otherTarball, integrity: source.integrity },
          },
        },
      }),
    );
    expect(
      finalizeStandardAssetSourceResponses({
        registryUrl,
        source,
        captured: [first, second, response(tarballUrl, new Uint8Array([1]))],
      }),
    ).toEqual({
      ok: false,
      note: 'esbuild-wasm@0.28.0 successful packuments disagree on tarball URL',
    });
  });

  it('uses npm-client scoped-name URL encoding exactly', () => {
    const scopedSource = { ...source, name: '@scope/pkg' };
    const scopedPackumentUrl = `${registryUrl}/@scope%2Fpkg`;
    const body = JSON.stringify({
      versions: {
        [source.version]: {
          dist: { tarball: tarballUrl, integrity: source.integrity },
        },
      },
    });
    const result = finalizeStandardAssetSourceResponses({
      registryUrl: `${registryUrl}/`,
      source: scopedSource,
      captured: [response(scopedPackumentUrl, body), response(tarballUrl, new Uint8Array([1]))],
    });

    expect(result).toMatchObject({ ok: true });
  });
});
