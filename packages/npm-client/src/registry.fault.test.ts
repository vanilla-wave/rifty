/**
 * Fault tier: `unbounded-read` at the STANDARD registry-fetch boundary
 * (docs/backlog/npm-client/registry-fetch-no-progress-bound.md). A registry/
 * proxy that hangs before headers, mid-packument, or mid-tarball must fail
 * LOUDLY within the stall bound (and ride the existing transient-retry
 * ladder) — never park `npm install` forever. Mirrors the eddy-path bounds
 * (PR #107 r5–r6) through the shared bounded-fetch chokepoint.
 */
import { describe, expect, it } from 'vitest';
import { RegistryClient } from './registry.ts';

const enc = new TextEncoder();

/** Response whose body delivers `chunks` then NEVER closes (mid-body stall). */
function stallingBodyResponse(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      // never close, never error — the stall.
    },
  });
  return new Response(stream, { status: 200 });
}

/** Body that keeps producing (the same shared 1MiB chunk) forever — runaway. */
function runawayBodyResponse(): Response {
  const chunk = new Uint8Array(1024 * 1024);
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(chunk);
    },
  });
  return new Response(stream, { status: 200 });
}

/** Body that trickles `chunks` with `gapMs` between them, then closes. */
function slowBodyResponse(chunks: string[], gapMs: number): Response {
  let i = 0;
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (i > 0) await new Promise((r) => setTimeout(r, gapMs));
      const c = chunks[i];
      i += 1;
      if (c === undefined) controller.close();
      else controller.enqueue(enc.encode(c));
    },
  });
  return new Response(stream, { status: 200 });
}

const PACKUMENT_JSON = '{"name":"x","versions":{}}';

describe('RegistryClient — unbounded-read fault tier (no-progress bounds)', () => {
  it('headers stall: a fetch that never responds fails loudly at the bound and aborts', async () => {
    const signals: (AbortSignal | undefined)[] = [];
    const fetch = ((_url: string, init?: RequestInit) => {
      signals.push(init?.signal ?? undefined);
      return new Promise<Response>(() => {}); // never settles
    }) as unknown as typeof globalThis.fetch;
    const client = new RegistryClient({
      baseUrl: 'https://r',
      fetch,
      maxRetries: 0,
      stallTimeoutMs: 25,
    });
    await expect(client.getPackument('x')).rejects.toThrow(
      'packument https://r/x: no response headers for 25ms',
    );
    expect(signals[0]?.aborted).toBe(true);
  });

  it('packument body stall: mid-JSON hang fails loudly at the bound', async () => {
    const fetch = (async () => stallingBodyResponse(['{"name":"x"'])) as typeof globalThis.fetch;
    const client = new RegistryClient({
      baseUrl: 'https://r',
      fetch,
      maxRetries: 0,
      stallTimeoutMs: 25,
    });
    await expect(client.getPackument('x')).rejects.toThrow(
      'packument https://r/x: no body progress for 25ms',
    );
  });

  it('tarball body stall: mid-bytes hang fails loudly at the bound', async () => {
    const fetch = (async () => stallingBodyResponse(['PK'])) as typeof globalThis.fetch;
    const client = new RegistryClient({
      baseUrl: 'https://r',
      fetch,
      maxRetries: 0,
      stallTimeoutMs: 25,
    });
    await expect(client.getTarball('https://r/x/-/x-1.tgz')).rejects.toThrow(
      'tarball https://r/x/-/x-1.tgz: no body progress for 25ms',
    );
  });

  it('runaway body: exceeding the byte cap throws loudly, never buffers unbounded', async () => {
    const fetch = (async () => runawayBodyResponse()) as typeof globalThis.fetch;
    const client = new RegistryClient({
      baseUrl: 'https://r',
      fetch,
      maxRetries: 0,
      stallTimeoutMs: 1000,
    });
    await expect(client.getTarball('https://r/x/-/x-1.tgz')).rejects.toThrow(
      `tarball https://r/x/-/x-1.tgz: body exceeded ${128 * 1024 * 1024} bytes`,
    );
  });

  it('slow-but-progressing body is NEVER aborted (window resets per chunk)', async () => {
    const parts = ['{"name":', '"x",', '"versions"', ':{}', '}'];
    const fetch = (async () => slowBodyResponse(parts, 10)) as typeof globalThis.fetch;
    const client = new RegistryClient({
      baseUrl: 'https://r',
      fetch,
      maxRetries: 0,
      stallTimeoutMs: 60,
    });
    const pack = await client.getPackument('x');
    expect(pack.name).toBe('x');
  });

  it('a stall is TRANSIENT: body-stalled attempt retries and succeeds on a healthy response', async () => {
    let calls = 0;
    const fetch = (async () => {
      calls += 1;
      if (calls === 1) return stallingBodyResponse(['{"na']);
      return new Response(PACKUMENT_JSON, { status: 200 });
    }) as typeof globalThis.fetch;
    const delays: number[] = [];
    const client = new RegistryClient({
      baseUrl: 'https://r',
      fetch,
      stallTimeoutMs: 25,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    const pack = await client.getPackument('x');
    expect(pack.name).toBe('x');
    expect(calls).toBe(2);
    expect(delays).toEqual([300]);
  });
});
