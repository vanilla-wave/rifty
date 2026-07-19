import { describe, expect, it } from 'vitest';
import { finalizeStandardAssetSourceResponses } from './shadow-asset-cold-cdp.mjs';

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
