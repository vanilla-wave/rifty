import { Buffer } from 'node:buffer';
import {
  SabRing,
  SyncRpcDispatcher,
  createSabRing,
  decodeReply,
  encodeRequest,
} from '@riftydev/kernel';
import { FS_RPC_CHUNK } from '@riftydev/runtime-js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  type OwnerViteConfigTempCacheSession,
  createOwnerVfsViteConfigTempCache,
} from './owner-vite-config-temp-cache.ts';
import {
  VITE_CONFIG_TEMP_CACHE_CAPABILITY,
  VITE_CONFIG_TEMP_CACHE_GENERATION_CAPACITY,
  VITE_CONFIG_TEMP_CACHE_METHODS,
  inspectViteConfigTempCacheAdmissionMessage,
} from './vite-config-temp-cache-protocol.ts';

const SOURCE_RELATIVE = 'node_modules/vite/dist/node/chunks/config.js';
const SOURCE_PATH = `/app/${SOURCE_RELATIVE}`;
const TEMP_DIRECTORY = '/app/node_modules/.vite-temp';
const GENERATED_PATH = `${TEMP_DIRECTORY}/vite.config.ts.timestamp-1700000000000-abcdef.mjs`;
const SECOND_GENERATED_PATH = `${TEMP_DIRECTORY}/vite.config.ts.timestamp-1700000000001-fedcba.mjs`;
const SOURCE_BYTES = new TextEncoder().encode('export const preparedViteConfigLoader = true;');
const RPC_PAYLOAD_CAPACITY = 512 * 1024;

function encoded(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

/** Exact dispatcher/SAB path with a deterministic same-turn owner pump. */
function createRpcHarness(dispatcher: SyncRpcDispatcher): {
  readonly call: <T>(method: string, payload: unknown) => T;
} {
  const { sab, ring: ownerRing } = createSabRing({ payloadCapacity: RPC_PAYLOAD_CAPACITY });
  const callerRing = SabRing.attach(sab, RPC_PAYLOAD_CAPACITY);
  return Object.freeze({
    call<T>(method: string, payload: unknown): T {
      callerRing.writeRequest(encodeRequest({ method, payload }));
      dispatcher.pumpOnce(ownerRing);
      const reply = decodeReply(callerRing.waitReply(1_000));
      if (reply.ok) return reply.value as T;
      const details = reply.error ?? { name: 'Error', message: 'unknown RPC failure' };
      const error = new Error(details.message);
      error.name = details.name;
      Object.assign(error, details);
      throw error;
    },
  });
}

async function tokenFor(session: OwnerViteConfigTempCacheSession): Promise<string> {
  const port = session.capabilityPorts[VITE_CONFIG_TEMP_CACHE_CAPABILITY];
  if (port === undefined) throw new Error('Vite config temp-cache admission omitted its port');
  const message = await new Promise<unknown>((resolve, reject) => {
    port.addEventListener('message', (event) => resolve(event.data), { once: true });
    port.addEventListener(
      'messageerror',
      () => reject(new Error('Vite config temp-cache admission could not decode')),
      { once: true },
    );
    port.start();
  });
  return inspectViteConfigTempCacheAdmissionMessage(message).token;
}

function createFixture(): {
  readonly call: <T>(method: string, payload: unknown) => T;
  readonly admit: () => Promise<{
    readonly token: string;
    readonly session: OwnerViteConfigTempCacheSession;
  }>;
  readonly close: () => void;
} {
  const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 60_000 });
  const authority = createOwnerVfsViteConfigTempCache({
    treeRevision: 17,
    versionOf(path) {
      return path === SOURCE_PATH ? 'vite-config-loader-v1' : null;
    },
    readFileBytesSync(path) {
      if (path !== SOURCE_PATH) throw new Error(`Unexpected source read: ${path}`);
      return SOURCE_BYTES.slice();
    },
  });
  authority.install(dispatcher);
  const project = authority.createProject('/app');
  const sessions = new Set<OwnerViteConfigTempCacheSession>();
  const rpc = createRpcHarness(dispatcher);
  return Object.freeze({
    call: rpc.call,
    async admit() {
      const session = project.admit(SOURCE_RELATIVE);
      sessions.add(session);
      return { session, token: await tokenFor(session) };
    },
    close() {
      for (const session of sessions) session.dispose();
      project.close();
      authority.close();
      dispatcher.detachAll();
    },
  });
}

function mkdir(call: <T>(method: string, payload: unknown) => T, token: string): void {
  call(VITE_CONFIG_TEMP_CACHE_METHODS.mkdir, {
    token,
    path: TEMP_DIRECTORY,
    recursive: true,
  });
}

function begin(
  call: <T>(method: string, payload: unknown) => T,
  token: string,
  path: string,
  size: number,
): void {
  call(VITE_CONFIG_TEMP_CACHE_METHODS.begin, { token, path, size });
}

function write(
  call: <T>(method: string, payload: unknown) => T,
  token: string,
  path: string,
  offset: number,
  bytes: Uint8Array,
): void {
  call(VITE_CONFIG_TEMP_CACHE_METHODS.write, {
    token,
    path,
    offset,
    bytes: encoded(bytes),
  });
}

function upload(
  call: <T>(method: string, payload: unknown) => T,
  token: string,
  path: string,
  bytes: Uint8Array,
): void {
  begin(call, token, path, bytes.byteLength);
  for (let offset = 0; offset < bytes.byteLength; offset += FS_RPC_CHUNK) {
    write(call, token, path, offset, bytes.subarray(offset, offset + FS_RPC_CHUNK));
  }
  call(VITE_CONFIG_TEMP_CACHE_METHODS.commit, { token, path });
}

const fixtures = new Set<{ close(): void }>();

afterEach(() => {
  for (const fixture of fixtures) fixture.close();
  fixtures.clear();
});

function trackedFixture(): ReturnType<typeof createFixture> {
  const fixture = createFixture();
  fixtures.add(fixture);
  return fixture;
}

describe('Owner Vite config temp-cache fault matrix', () => {
  it('round-trips the exact 8 MiB generation maximum through SyncRpcDispatcher/SAB and rejects max + 1 loudly', async () => {
    const fixture = trackedFixture();
    const { token } = await fixture.admit();
    mkdir(fixture.call, token);
    const maximum = new Uint8Array(VITE_CONFIG_TEMP_CACHE_GENERATION_CAPACITY);
    for (let index = 0; index < maximum.byteLength; index += 1) maximum[index] = index % 251;

    upload(fixture.call, token, GENERATED_PATH, maximum);

    expect(
      fixture.call(VITE_CONFIG_TEMP_CACHE_METHODS.inspect, {
        token,
        path: GENERATED_PATH,
      }),
    ).toEqual({ size: VITE_CONFIG_TEMP_CACHE_GENERATION_CAPACITY });
    for (let offset = 0; offset < maximum.byteLength; offset += FS_RPC_CHUNK) {
      const expected = maximum.subarray(offset, offset + FS_RPC_CHUNK);
      expect(
        fixture.call<Uint8Array>(VITE_CONFIG_TEMP_CACHE_METHODS.read, {
          token,
          path: GENERATED_PATH,
          offset,
          length: expected.byteLength,
        }),
      ).toEqual(expected);
    }

    fixture.call(VITE_CONFIG_TEMP_CACHE_METHODS.remove, { token, path: GENERATED_PATH });
    expect(() =>
      begin(fixture.call, token, GENERATED_PATH, VITE_CONFIG_TEMP_CACHE_GENERATION_CAPACITY + 1),
    ).toThrowError(
      expect.objectContaining({
        name: 'NotImplementedError',
        message: expect.stringContaining('playground.vite-config-temp-cache.capacity'),
      }),
    );
  });

  it('keeps a torn, uncommitted upload invisible and rejects premature commit/read', async () => {
    const fixture = trackedFixture();
    const { token } = await fixture.admit();
    mkdir(fixture.call, token);
    begin(fixture.call, token, GENERATED_PATH, 2);
    write(fixture.call, token, GENERATED_PATH, 0, new Uint8Array([0x61]));

    expect(
      fixture.call(VITE_CONFIG_TEMP_CACHE_METHODS.inspect, {
        token,
        path: GENERATED_PATH,
      }),
    ).toBeNull();
    expect(() =>
      fixture.call(VITE_CONFIG_TEMP_CACHE_METHODS.read, {
        token,
        path: GENERATED_PATH,
        offset: 0,
        length: 1,
      }),
    ).toThrowError(expect.objectContaining({ code: 'ENOENT' }));
    expect(() =>
      fixture.call(VITE_CONFIG_TEMP_CACHE_METHODS.commit, {
        token,
        path: GENERATED_PATH,
      }),
    ).toThrow(/upload is incomplete/);
  });

  it('isolates overlapping generations at the same logical path and rejects every late call after retirement', async () => {
    const fixture = trackedFixture();
    const first = await fixture.admit();
    const second = await fixture.admit();
    mkdir(fixture.call, first.token);
    mkdir(fixture.call, second.token);
    upload(fixture.call, first.token, GENERATED_PATH, new Uint8Array([0x6f, 0x6c, 0x64]));
    upload(fixture.call, second.token, GENERATED_PATH, new Uint8Array([0x6e, 0x65, 0x77]));

    expect(
      fixture.call<Uint8Array>(VITE_CONFIG_TEMP_CACHE_METHODS.read, {
        token: first.token,
        path: GENERATED_PATH,
        offset: 0,
        length: 3,
      }),
    ).toEqual(new Uint8Array([0x6f, 0x6c, 0x64]));
    expect(
      fixture.call<Uint8Array>(VITE_CONFIG_TEMP_CACHE_METHODS.read, {
        token: second.token,
        path: GENERATED_PATH,
        offset: 0,
        length: 3,
      }),
    ).toEqual(new Uint8Array([0x6e, 0x65, 0x77]));

    first.session.dispose();
    expect(() =>
      fixture.call(VITE_CONFIG_TEMP_CACHE_METHODS.scope, { token: first.token }),
    ).toThrow(/admission is retired or invalid/);
    expect(
      fixture.call<Uint8Array>(VITE_CONFIG_TEMP_CACHE_METHODS.read, {
        token: second.token,
        path: GENERATED_PATH,
        offset: 0,
        length: 3,
      }),
    ).toEqual(new Uint8Array([0x6e, 0x65, 0x77]));

    second.session.dispose();
    expect(() => begin(fixture.call, second.token, SECOND_GENERATED_PATH, 1)).toThrow(
      /admission is retired or invalid/,
    );
  });

  it('releases reserved capacity on both remove and abort', async () => {
    const fixture = trackedFixture();
    const { token } = await fixture.admit();
    mkdir(fixture.call, token);
    upload(fixture.call, token, GENERATED_PATH, new Uint8Array([0x61]));
    begin(
      fixture.call,
      token,
      SECOND_GENERATED_PATH,
      VITE_CONFIG_TEMP_CACHE_GENERATION_CAPACITY - 1,
    );

    expect(() =>
      begin(
        fixture.call,
        token,
        `${TEMP_DIRECTORY}/vite.config.ts.timestamp-1700000000002-aabbcc.mjs`,
        1,
      ),
    ).toThrowError(expect.objectContaining({ name: 'NotImplementedError' }));

    fixture.call(VITE_CONFIG_TEMP_CACHE_METHODS.remove, { token, path: GENERATED_PATH });
    const thirdPath = `${TEMP_DIRECTORY}/vite.config.ts.timestamp-1700000000002-aabbcc.mjs`;
    begin(fixture.call, token, thirdPath, 1);
    fixture.call(VITE_CONFIG_TEMP_CACHE_METHODS.abort, {
      token,
      path: SECOND_GENERATED_PATH,
    });
    fixture.call(VITE_CONFIG_TEMP_CACHE_METHODS.abort, { token, path: thirdPath });

    expect(() =>
      begin(fixture.call, token, GENERATED_PATH, VITE_CONFIG_TEMP_CACHE_GENERATION_CAPACITY),
    ).not.toThrow();
  });

  it('accepts the exact empty random-hex suffix produced when upstream Math.random returns zero', async () => {
    const fixture = trackedFixture();
    const { token } = await fixture.admit();
    mkdir(fixture.call, token);
    const zeroRandomPath = `${TEMP_DIRECTORY}/vite.config.ts.timestamp-1700000000000-.mjs`;

    expect(() => upload(fixture.call, token, zeroRandomPath, new Uint8Array([0x78]))).not.toThrow();
    expect(
      fixture.call(VITE_CONFIG_TEMP_CACHE_METHODS.inspect, {
        token,
        path: zeroRandomPath,
      }),
    ).toEqual({ size: 1 });
  });
});
