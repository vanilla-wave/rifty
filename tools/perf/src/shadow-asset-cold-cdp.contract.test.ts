import { describe, expect, it } from 'vitest';
import {
  finalizeStandardAssetSourceResponses,
  startCdpResponseRecorder,
} from './shadow-asset-cold-cdp.mjs';

type CdpHandler = (event: Record<string, unknown>) => void;

class FakeCdpSession {
  readonly calls: Array<{ readonly method: string; readonly params?: Record<string, unknown> }> = [];
  readonly bodies = new Map<
    string,
    | { readonly body: string; readonly base64Encoded: boolean }
    | Error
    | Promise<{ readonly body: string; readonly base64Encoded: boolean }>
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
    if (method !== 'Network.getResponseBody') throw new Error(`unexpected CDP command ${method}`);
    const requestId = String(params?.requestId);
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

function cdpResponse(
  requestId: string,
  url: string,
  overrides: Record<string, unknown> = {},
) {
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
  it('enables Network and records exact decoded text and binary response-body bytes', async () => {
    const session = new FakeCdpSession();
    const text = '{"name":"esbuild-wasm"}';
    const binary = Uint8Array.from([0, 255, 1, 254]);
    session.bodies.set('packument', { body: text, base64Encoded: false });
    session.bodies.set('tarball', {
      body: Buffer.from(binary).toString('base64'),
      base64Encoded: true,
    });

    const recorder = await startCdpResponseRecorder(fakePage(session));
    session.emit('Network.responseReceived', cdpResponse('packument', packumentUrl));
    session.emit('Network.loadingFinished', { requestId: 'packument' });
    session.emit('Network.responseReceived', cdpResponse('tarball', tarballUrl));
    session.emit('Network.loadingFinished', { requestId: 'tarball' });

    await expect(recorder.stop()).resolves.toEqual([
      {
        requestId: 'packument',
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
      { method: 'Network.getResponseBody', params: { requestId: 'packument' } },
      { method: 'Network.getResponseBody', params: { requestId: 'tarball' } },
      { method: 'detach' },
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
        error:
          'Network.getResponseBody failed: No resource with given identifier found',
      }),
    ]);
  });

  it('waits for pending getResponseBody work before detaching and makes stop idempotent', async () => {
    const session = new FakeCdpSession();
    let resolveBody: ((value: { readonly body: string; readonly base64Encoded: boolean }) => void) | undefined;
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
      { method: 'Network.getResponseBody', params: { requestId: 'pending' } },
    ]);

    resolveBody?.({ body: '{}', base64Encoded: false });
    await expect(firstStop).resolves.toEqual(await secondStop);
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

function response(
  url: string,
  body: string | Uint8Array,
  overrides: Record<string, unknown> = {},
) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return {
    requestId: `request-${Math.random()}`,
    url,
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
      captured: [
        response('https://registry.example/npm-registry/vite', '{}'),
        response(tarballUrl, new Uint8Array([1, 2, 3])),
        response(packumentUrl, body),
      ],
    });

    expect(result).toEqual({
      ok: true,
      sourceResponses: [
        {
          source: 'tarball',
          url: tarballUrl,
          protocol: 'h2',
          bodyBytes: 3,
          complete: true,
          fromDiskCache: false,
          fromServiceWorker: false,
        },
        {
          source: 'packument',
          url: packumentUrl,
          protocol: 'h2',
          bodyBytes: new TextEncoder().encode(body).byteLength,
          complete: true,
          fromDiskCache: false,
          fromServiceWorker: false,
        },
      ],
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
    expect(
      finalizeStandardAssetSourceResponses({ registryUrl, source, captured: [] }),
    ).toEqual({
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
