/**
 * riftyGitHttp — isomorphic-git `http` plugin backed by `@riftydev/net`
 * egress. The net `request` fn is INJECTED here with a fake ClientRequest /
 * IncomingMessage pair: that's the legitimate external-boundary substitution
 * (the network), NOT a mock of the plugin's own wiring. Asserts request-body
 * forwarding, response drain into an async-iterable, and error propagation.
 */
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { riftyGitHttp } from '../src/http-plugin.ts';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}

async function drain(body: AsyncIterableIterator<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for await (const c of body) chunks.push(c);
  return concat(chunks);
}

/** A fake response: Node-Readable-shaped EventEmitter the plugin drains. */
interface FakeRes extends EventEmitter {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string>;
  /** Emit data/end (or a mid-stream error). Called once listeners attach. */
  drive(): void;
}

/** Records what the plugin wrote, then drives the response on next-tick. */
interface FakeReqRecord {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  writes: Uint8Array[];
  ended: boolean;
  aborted: boolean;
}

function makeFake(opts: {
  res?: FakeRes;
  emitError?: Error;
  record: FakeReqRecord;
}): typeof import('@riftydev/net').request {
  // biome-ignore lint/suspicious/noExplicitAny: test boundary fake
  const fakeRequest = ((urlOrOpts: any, optsOrCb: any, maybeCb: any): EventEmitter => {
    const url = typeof urlOrOpts === 'string' ? urlOrOpts : undefined;
    const o = typeof optsOrCb === 'object' ? optsOrCb : undefined;
    opts.record.url = url;
    opts.record.method = o?.method;
    opts.record.headers = o?.headers;
    void maybeCb;

    const req = new EventEmitter() as EventEmitter & {
      write(c: Uint8Array | string): boolean;
      end(): void;
      abort(): void;
      destroy(): void;
    };
    req.write = (c: Uint8Array | string): boolean => {
      opts.record.writes.push(typeof c === 'string' ? enc(c) : c);
      return true;
    };
    req.end = (): void => {
      opts.record.ended = true;
      // Drive the response asynchronously so the plugin's await is exercised.
      queueMicrotask(() => {
        if (opts.emitError) {
          req.emit('error', opts.emitError);
          return;
        }
        const res = opts.res;
        if (!res) return;
        req.emit('response', res);
        // Stream data/end only AFTER the plugin's 'response' handler attaches
        // its drain listeners — models net's paused Readable handing off first.
        res.drive();
      });
    };
    req.abort = (): void => {
      opts.record.aborted = true;
    };
    req.destroy = (): void => {
      opts.record.aborted = true;
    };
    return req;
  }) as unknown as typeof import('@riftydev/net').request;
  return fakeRequest;
}

function makeFakeRes(
  statusCode: number,
  statusMessage: string,
  headers: Record<string, string>,
  chunks: Uint8Array[],
): FakeRes {
  const res = new EventEmitter() as FakeRes;
  res.statusCode = statusCode;
  res.statusMessage = statusMessage;
  res.headers = headers;
  // Emit data/end on the next microtask wave (after the plugin subscribes).
  res.drive = (): void => {
    queueMicrotask(() => {
      for (const c of chunks) res.emit('data', c);
      res.emit('end');
    });
  };
  return res;
}

describe('riftyGitHttp', () => {
  it('GET without body: forwards method/url/headers, resolves status + drains body', async () => {
    const record: FakeReqRecord = { writes: [], ended: false, aborted: false };
    const res = makeFakeRes(
      200,
      'OK',
      { 'content-type': 'application/x-git-upload-pack-advertisement' },
      [enc('001e# service'), enc('=git-upload-pack\n')],
    );
    const http = riftyGitHttp({ request: makeFake({ res, record }) });

    const out = await http.request({
      url: 'https://github.com/o/r.git/info/refs?service=git-upload-pack',
      method: 'GET',
      headers: { 'user-agent': 'rifty-git' },
    });

    expect(record.method).toBe('GET');
    expect(record.url).toBe('https://github.com/o/r.git/info/refs?service=git-upload-pack');
    expect(record.headers).toMatchObject({ 'user-agent': 'rifty-git' });
    expect(record.ended).toBe(true);
    expect(record.writes).toHaveLength(0);

    expect(out.statusCode).toBe(200);
    expect(out.statusMessage).toBe('OK');
    expect(out.headers['content-type']).toBe('application/x-git-upload-pack-advertisement');
    expect(out.method).toBe('GET');
    expect(out.url).toBe('https://github.com/o/r.git/info/refs?service=git-upload-pack');

    const body = await drain(out.body as AsyncIterableIterator<Uint8Array>);
    expect(new TextDecoder().decode(body)).toBe('001e# service=git-upload-pack\n');
  });

  it('POST with an async-iterable body: writes each chunk in order before end', async () => {
    const record: FakeReqRecord = { writes: [], ended: false, aborted: false };
    const res = makeFakeRes(200, 'OK', {}, [enc('pack-data')]);
    const http = riftyGitHttp({ request: makeFake({ res, record }) });

    async function* bodyGen(): AsyncIterableIterator<Uint8Array> {
      yield enc('chunk-1|');
      yield enc('chunk-2|');
      yield enc('chunk-3');
    }

    const out = await http.request({
      url: 'https://github.com/o/r.git/git-upload-pack',
      method: 'POST',
      headers: { 'content-type': 'application/x-git-upload-pack-request' },
      body: bodyGen(),
    });

    expect(record.method).toBe('POST');
    expect(record.ended).toBe(true);
    expect(record.writes.map((c) => new TextDecoder().decode(c))).toEqual([
      'chunk-1|',
      'chunk-2|',
      'chunk-3',
    ]);
    const body = await drain(out.body as AsyncIterableIterator<Uint8Array>);
    expect(new TextDecoder().decode(body)).toBe('pack-data');
  });

  it('response error propagates as a rejected promise', async () => {
    const record: FakeReqRecord = { writes: [], ended: false, aborted: false };
    const http = riftyGitHttp({
      request: makeFake({ emitError: new Error('ECONNREFUSED boom'), record }),
    });

    await expect(
      http.request({ url: 'https://nope.example/r.git/info/refs', method: 'GET', headers: {} }),
    ).rejects.toThrow(/ECONNREFUSED boom/);
  });

  it('error mid-stream rejects the body async-iterable', async () => {
    const record: FakeReqRecord = { writes: [], ended: false, aborted: false };
    const res = new EventEmitter() as FakeRes;
    res.statusCode = 200;
    res.statusMessage = 'OK';
    res.headers = {};
    res.drive = (): void => {
      queueMicrotask(() => {
        res.emit('data', enc('partial'));
        res.emit('error', new Error('stream blew up'));
      });
    };
    const http = riftyGitHttp({ request: makeFake({ res, record }) });

    const out = await http.request({
      url: 'https://github.com/o/r.git/git-upload-pack',
      method: 'POST',
      headers: {},
    });
    await expect(drain(out.body as AsyncIterableIterator<Uint8Array>)).rejects.toThrow(
      /stream blew up/,
    );
  });
});
