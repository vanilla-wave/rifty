/**
 * `resolveEddyClosure` — the stale-pin background revalidate primitive
 * (backlog playground/eddy-stale-pin-revalidate): a plain POST resolve whose
 * body is read ONLY up to the manifest (first tar member) then cancelled — no
 * wire-protocol change, no full-bundle download. Bounded like every other
 * eddy acquisition path (header phase + no-progress + byte cap, ADR-0201).
 */
import { describe, expect, it } from 'vitest';
import { type EddyBundleManifestV1, packEddyBundle } from './eddy-bundle.ts';
import type { EddyRequestBody } from './eddy-request.ts';
import { resolveEddyClosure } from './eddy-revalidate.ts';

const REQUEST: EddyRequestBody = { dependencies: { debug: '^4.4.1' }, optionalDependencies: {} };

function makeManifest(overrides: Partial<EddyBundleManifestV1['asOf']> = {}): EddyBundleManifestV1 {
  return {
    format: 'EddyBundleV1',
    npmClientVersion: '0.0.0-test',
    asOf: {
      resolvedAt: '2026-07-10T12:00:00.000Z',
      registry: 'https://registry.npmjs.org',
      closureHash: 'sha256-closure/abc=',
      ...overrides,
    },
    tarballs: [
      { file: 'tarballs/debug-4.4.1.tgz', name: 'debug', version: '4.4.1', integrity: 'sha512-x' },
    ],
  };
}

function bundleBytes(manifest: EddyBundleManifestV1): Uint8Array {
  return packEddyBundle({
    manifest,
    lockfileText: JSON.stringify({ lockfileVersion: 3, packages: {} }),
    tarballs: [{ entry: manifest.tarballs[0] as never, bytes: new Uint8Array(4096) }],
  });
}

/** Response streaming `bytes` in two phases: everything up to `headBytes`
 * immediately, then the remainder in 512-byte pulls — so a manifest-only
 * reader shows up as "cancelled with most pulls never made". */
function chunkedBundleResponse(bytes: Uint8Array, headBytes: number) {
  let offset = headBytes;
  let pulls = 0;
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.subarray(0, headBytes));
    },
    pull(controller) {
      pulls++;
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.subarray(offset, offset + 512));
      offset += 512;
    },
    cancel() {
      cancelled = true;
    },
  });
  return {
    response: new Response(stream, { status: 200 }),
    counters: {
      get pulls() {
        return pulls;
      },
      get cancelled() {
        return cancelled;
      },
    },
  };
}

/** Bytes of the manifest MEMBER only (header + padded JSON) — the prefix a
 * manifest-only reader needs. */
function manifestMemberBytes(manifest: EddyBundleManifestV1): number {
  const json = new TextEncoder().encode(JSON.stringify(manifest)).length;
  return 512 + Math.ceil(json / 512) * 512;
}

describe('resolveEddyClosure (manifest-only POST revalidate)', () => {
  it('POSTs CORS-simple and returns the manifest asOf, cancelling after the FIRST member — never the full bundle', async () => {
    const manifest = makeManifest();
    const bytes = bundleBytes(manifest);
    const head = manifestMemberBytes(manifest);
    const { response, counters } = chunkedBundleResponse(bytes, head);
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      seen.push({ url: String(url), init });
      return response;
    };

    const out = await resolveEddyClosure({
      resolverUrl: 'http://eddy.test/resolve',
      request: REQUEST,
      fetchImpl,
    });

    expect(out).toEqual({
      closureHash: 'sha256-closure/abc=',
      resolvedAt: '2026-07-10T12:00:00.000Z',
    });
    // Wire shape = the installer's POST: CORS-simple (no content-type header),
    // JSON body of the request.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.init?.method).toBe('POST');
    expect(new Headers(seen[0]?.init?.headers).get('content-type')).toBeNull();
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual(REQUEST);
    // Early-cancel proof: the source was cancelled with the tarball tail
    // still unpulled (the remainder is ~10 pulls of 512B).
    expect(counters.cancelled).toBe(true);
    expect(counters.pulls).toBeLessThan(4);
  });

  it('a typed JSON decline (422) throws with the decline reason (bounded drain, never response.json())', async () => {
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ feature: 'workspace' }), {
        status: 422,
        headers: { 'content-type': 'application/json' },
      });

    await expect(
      resolveEddyClosure({ resolverUrl: 'http://eddy.test', request: REQUEST, fetchImpl }),
    ).rejects.toThrow(/resolver declined \(workspace\)/);
  });

  it('a non-ok status throws with the status', async () => {
    const fetchImpl: typeof fetch = async () => new Response('boom', { status: 500 });

    await expect(
      resolveEddyClosure({ resolverUrl: 'http://eddy.test', request: REQUEST, fetchImpl }),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('a body that stops making progress rejects within the no-progress bound (never parks the caller)', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start() {
        /* never enqueues */
      },
    });
    const fetchImpl: typeof fetch = async () => new Response(stream, { status: 200 });

    await expect(
      resolveEddyClosure({
        resolverUrl: 'http://eddy.test',
        request: REQUEST,
        fetchImpl,
        stallTimeoutMs: 25,
      }),
    ).rejects.toThrow(/no body progress/);
  });

  it('headers that never arrive reject within the same bound (header-phase chokepoint)', async () => {
    const fetchImpl: typeof fetch = () => new Promise<Response>(() => {});

    await expect(
      resolveEddyClosure({
        resolverUrl: 'http://eddy.test',
        request: REQUEST,
        fetchImpl,
        stallTimeoutMs: 25,
      }),
    ).rejects.toThrow(/eddy revalidate/);
  });

  it('an unsupported bundle format throws instead of trusting a foreign manifest', async () => {
    const manifest = { ...makeManifest(), format: 'EddyBundleV9' } as never;
    const fetchImpl: typeof fetch = async () =>
      new Response(new Uint8Array(bundleBytes(manifest)), { status: 200 });

    await expect(
      resolveEddyClosure({ resolverUrl: 'http://eddy.test', request: REQUEST, fetchImpl }),
    ).rejects.toThrow(/unsupported EddyBundle format/i);
  });

  it('a manifest missing asOf fields throws malformed instead of returning undefined shapes', async () => {
    const manifest = makeManifest();
    (manifest.asOf as { closureHash?: string }).closureHash = undefined;
    const fetchImpl: typeof fetch = async () =>
      new Response(new Uint8Array(bundleBytes(manifest)), { status: 200 });

    await expect(
      resolveEddyClosure({ resolverUrl: 'http://eddy.test', request: REQUEST, fetchImpl }),
    ).rejects.toThrow(/malformed/i);
  });
});
