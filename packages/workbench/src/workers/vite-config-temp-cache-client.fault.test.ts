import {
  SabRing,
  SyncRpcDispatcher,
  createSabRing,
  decodeReply,
  encodeRequest,
} from '@riftydev/kernel';
import { FS_RPC_CHUNK, type SyncCall } from '@riftydev/runtime-js';
import {
  existsSync as nodeExistsSync,
  readFileSync as nodeReadFileSync,
  readdirSync as nodeReaddirSync,
} from '@riftydev/runtime-js/builtins/fs';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type OwnerViteConfigTempCacheSession,
  createOwnerVfsViteConfigTempCache,
} from './owner-vite-config-temp-cache.ts';
import {
  type ViteConfigTempFs,
  installViteConfigTempCacheClient,
} from './vite-config-temp-cache-client.ts';
import {
  VITE_CONFIG_TEMP_CACHE_ADMISSION_TIMEOUT_MS,
  VITE_CONFIG_TEMP_CACHE_BINDING,
  VITE_CONFIG_TEMP_CACHE_METHODS,
} from './vite-config-temp-cache-protocol.ts';

const SOURCE_RELATIVE = 'node_modules/vite/dist/node/chunks/config.js';
const SOURCE_PATH = `/app/${SOURCE_RELATIVE}`;
const SOURCE_TEXT = 'export const preparedViteConfigLoader = true;';
const TEMP_DIRECTORY = '/app/node_modules/.vite-temp';
const GENERATED_PATH = `${TEMP_DIRECTORY}/vite.config.ts.timestamp-1700000000000-abcdef.mjs`;
const RPC_PAYLOAD_CAPACITY = 512 * 1024;

function createRpcHarness(dispatcher: SyncRpcDispatcher): { readonly call: SyncCall } {
  const { sab, ring: ownerRing } = createSabRing({ payloadCapacity: RPC_PAYLOAD_CAPACITY });
  const callerRing = SabRing.attach(sab, RPC_PAYLOAD_CAPACITY);
  return Object.freeze({
    call(method: string, payload: unknown): unknown {
      callerRing.writeRequest(encodeRequest({ method, payload }));
      dispatcher.pumpOnce(ownerRing);
      const reply = decodeReply(callerRing.waitReply(1_000));
      if (reply.ok) return reply.value;
      const details = reply.error ?? { name: 'Error', message: 'unknown RPC failure' };
      const error = new Error(details.message);
      error.name = details.name;
      Object.assign(error, details);
      throw error;
    },
  });
}

function clientFrom(imports: Readonly<Record<string, unknown>>): ViteConfigTempFs {
  const candidate = imports[VITE_CONFIG_TEMP_CACHE_BINDING];
  if (typeof candidate !== 'object' || candidate === null) {
    throw new Error('Exact Vite config-loader binding omitted its cache client');
  }
  return candidate as ViteConfigTempFs;
}

function unlink(client: ViteConfigTempFs, path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.unlink(path, (error) => {
      if (error === null) resolve();
      else reject(error);
    });
  });
}

interface ClientFixture {
  readonly base: MemoryFsSync;
  readonly call: SyncCall;
  readonly session: OwnerViteConfigTempCacheSession;
  readonly close: () => void;
}

function createFixture(): ClientFixture {
  const base = new MemoryFsSync();
  base.loadFixture({ [SOURCE_PATH]: SOURCE_TEXT });
  const sourceBytes = new TextEncoder().encode(SOURCE_TEXT);
  const dispatcher = new SyncRpcDispatcher({ pollIntervalMs: 60_000 });
  const authority = createOwnerVfsViteConfigTempCache({
    treeRevision: 23,
    versionOf(path) {
      return path === SOURCE_PATH ? 'vite-config-loader-v1' : null;
    },
    readFileBytesSync(path) {
      return base.readFileBytesSync(path);
    },
  });
  authority.install(dispatcher);
  const project = authority.createProject('/app');
  const session = project.admit(SOURCE_RELATIVE);
  const { call } = createRpcHarness(dispatcher);
  return Object.freeze({
    base,
    call,
    session,
    close() {
      session.dispose();
      project.close();
      authority.close();
      dispatcher.detachAll();
      expect(base.readFileBytesSync(SOURCE_PATH)).toEqual(sourceBytes);
    },
  });
}

const fixtures = new Set<ClientFixture>();

afterEach(() => {
  vi.useRealTimers();
  resetSyncMirror();
  for (const fixture of fixtures) fixture.close();
  fixtures.clear();
});

function trackedFixture(): ClientFixture {
  const fixture = createFixture();
  fixtures.add(fixture);
  return fixture;
}

describe('Vite config temp-cache client fault boundaries', () => {
  it('bounds silent admission peer death before any sync-RPC call', async () => {
    vi.useFakeTimers();
    const channel = new MessageChannel();
    const call = vi.fn<SyncCall>();
    const outcome = installViteConfigTempCacheClient({
      port: channel.port2,
      call,
      base: new MemoryFsSync(),
    }).then(
      () => 'resolved' as const,
      (error: unknown) => error,
    );
    channel.port1.close();

    await vi.advanceTimersByTimeAsync(VITE_CONFIG_TEMP_CACHE_ADMISSION_TIMEOUT_MS);
    const settled = await Promise.race([outcome, Promise.resolve('pending' as const)]);

    expect(settled).toEqual(
      expect.objectContaining({
        message: `Vite config temp-cache admission timed out after ${String(VITE_CONFIG_TEMP_CACHE_ADMISSION_TIMEOUT_MS)}ms`,
      }),
    );
    expect(call).not.toHaveBeenCalled();
    channel.port2.close();
  });

  it('exposes committed generated bytes only to the loader overlay, never base readdir or node:fs', async () => {
    const fixture = trackedFixture();
    setSyncMirror(fixture.base);
    let admittedToken: string | undefined;
    const call: SyncCall = (method, payload) => {
      if (method === VITE_CONFIG_TEMP_CACHE_METHODS.scope) {
        admittedToken = (payload as { readonly token?: string }).token;
      }
      return fixture.call(method, payload);
    };
    const port = fixture.session.capabilityPorts['rifty.vite-config-temp-cache.v1'];
    if (port === undefined) throw new Error('Vite config temp-cache admission omitted its port');
    const installed = await installViteConfigTempCacheClient({
      port,
      call,
      base: fixture.base,
    });
    const client = clientFrom(installed.exactEsmModuleBinding.imports);
    const generatedText = `export default ${JSON.stringify('x'.repeat(FS_RPC_CHUNK + 7))};`;

    await client.mkdir(TEMP_DIRECTORY, { recursive: true });
    await client.writeFile(GENERATED_PATH, generatedText);

    expect(new TextDecoder().decode(installed.loaderFs.readFileBytesSync(GENERATED_PATH))).toBe(
      generatedText,
    );
    expect(installed.loaderFs.statSync(GENERATED_PATH)).toMatchObject({
      isFile: true,
      isDirectory: false,
      size: new TextEncoder().encode(generatedText).byteLength,
    });
    expect(fixture.base.existsSync(TEMP_DIRECTORY)).toBe(false);
    expect(fixture.base.existsSync(GENERATED_PATH)).toBe(false);
    expect(fixture.base.readdirSync('/app/node_modules').map((entry) => entry.name)).toEqual([
      'vite',
    ]);
    expect(installed.loaderFs.readdirSync('/app/node_modules')).toEqual(
      fixture.base.readdirSync('/app/node_modules'),
    );
    expect(nodeExistsSync(GENERATED_PATH)).toBe(false);
    expect(nodeReaddirSync('/app/node_modules')).toEqual(['vite']);
    expect(() => nodeReadFileSync(GENERATED_PATH)).toThrowError(
      expect.objectContaining({ code: 'ENOENT' }),
    );
    expect(installed.exactEsmModuleBinding.path.endsWith(`/${SOURCE_RELATIVE}`)).toBe(true);
    expect(installed.exactEsmModuleBinding.sourceBytes).toEqual(
      new TextEncoder().encode(SOURCE_TEXT),
    );

    await unlink(client, GENERATED_PATH);

    expect(installed.loaderFs.existsSync(GENERATED_PATH)).toBe(false);
    if (admittedToken === undefined)
      throw new Error('Cache client did not use its admission token');
    expect(
      fixture.call(VITE_CONFIG_TEMP_CACHE_METHODS.inspect, {
        token: admittedToken,
        path: GENERATED_PATH,
      }),
    ).toBeNull();
    expect(fixture.base.existsSync(TEMP_DIRECTORY)).toBe(false);
  });

  it('aborts a torn multi-chunk upload, keeps it invisible, and permits a fresh retry', async () => {
    const fixture = trackedFixture();
    let admittedToken: string | undefined;
    let writeCalls = 0;
    const injectedFailure = new Error('injected second cache chunk failure');
    const call: SyncCall = (method, payload) => {
      const token = (payload as { readonly token?: string }).token;
      if (token !== undefined) admittedToken = token;
      if (method === VITE_CONFIG_TEMP_CACHE_METHODS.write) {
        writeCalls += 1;
        if (writeCalls === 2) throw injectedFailure;
      }
      return fixture.call(method, payload);
    };
    const port = fixture.session.capabilityPorts['rifty.vite-config-temp-cache.v1'];
    if (port === undefined) throw new Error('Vite config temp-cache admission omitted its port');
    const installed = await installViteConfigTempCacheClient({
      port,
      call,
      base: fixture.base,
    });
    const client = clientFrom(installed.exactEsmModuleBinding.imports);
    await client.mkdir(TEMP_DIRECTORY, { recursive: true });

    await expect(client.writeFile(GENERATED_PATH, 'a'.repeat(FS_RPC_CHUNK + 1))).rejects.toBe(
      injectedFailure,
    );

    expect(installed.loaderFs.existsSync(GENERATED_PATH)).toBe(false);
    if (admittedToken === undefined)
      throw new Error('Cache client did not use its admission token');
    expect(
      fixture.call(VITE_CONFIG_TEMP_CACHE_METHODS.inspect, {
        token: admittedToken,
        path: GENERATED_PATH,
      }),
    ).toBeNull();
    expect(fixture.base.existsSync(GENERATED_PATH)).toBe(false);

    await expect(client.writeFile(GENERATED_PATH, 'fresh')).resolves.toBeUndefined();
    expect(new TextDecoder().decode(installed.loaderFs.readFileBytesSync(GENERATED_PATH))).toBe(
      'fresh',
    );
  });

  it('releases an owner allocation when the begin reply is lost', async () => {
    const fixture = trackedFixture();
    let admittedToken: string | undefined;
    const responseLost = new Error('begin response lost after owner allocation');
    let loseBeginReply = true;
    const call: SyncCall = (method, payload) => {
      const token = (payload as { readonly token?: string }).token;
      if (token !== undefined) admittedToken = token;
      const result = fixture.call(method, payload);
      if (method === VITE_CONFIG_TEMP_CACHE_METHODS.begin && loseBeginReply) {
        loseBeginReply = false;
        throw responseLost;
      }
      return result;
    };
    const port = fixture.session.capabilityPorts['rifty.vite-config-temp-cache.v1'];
    if (port === undefined) throw new Error('Vite config temp-cache admission omitted its port');
    const installed = await installViteConfigTempCacheClient({ port, call, base: fixture.base });
    const client = clientFrom(installed.exactEsmModuleBinding.imports);
    await client.mkdir(TEMP_DIRECTORY, { recursive: true });

    await expect(client.writeFile(GENERATED_PATH, 'x')).rejects.toBe(responseLost);

    if (admittedToken === undefined)
      throw new Error('Cache client did not use its admission token');
    expect(() =>
      fixture.call(VITE_CONFIG_TEMP_CACHE_METHODS.begin, {
        token: admittedToken,
        path: `${TEMP_DIRECTORY}/vite.config.ts.timestamp-1700000000001-fedcba.mjs`,
        size: 8 * 1024 * 1024,
      }),
    ).not.toThrow();
  });

  it('retires after abort failure without hiding either upload or cleanup provenance', async () => {
    const fixture = trackedFixture();
    let admittedToken: string | undefined;
    let writeCalls = 0;
    const uploadError = new Error('second chunk upload failed');
    const abortError = new Error('abort reply lost');
    const call: SyncCall = (method, payload) => {
      const token = (payload as { readonly token?: string }).token;
      if (token !== undefined) admittedToken = token;
      if (method === VITE_CONFIG_TEMP_CACHE_METHODS.write && ++writeCalls === 2) {
        throw uploadError;
      }
      const result = fixture.call(method, payload);
      if (method === VITE_CONFIG_TEMP_CACHE_METHODS.abort) throw abortError;
      return result;
    };
    const port = fixture.session.capabilityPorts['rifty.vite-config-temp-cache.v1'];
    if (port === undefined) throw new Error('Vite config temp-cache admission omitted its port');
    const installed = await installViteConfigTempCacheClient({ port, call, base: fixture.base });
    const client = clientFrom(installed.exactEsmModuleBinding.imports);
    await client.mkdir(TEMP_DIRECTORY, { recursive: true });

    const failure = await client.writeFile(GENERATED_PATH, 'x'.repeat(FS_RPC_CHUNK + 1)).then(
      () => null,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors).toEqual([uploadError, abortError]);
    if (admittedToken === undefined)
      throw new Error('Cache client did not use its admission token');
    expect(() =>
      fixture.call(VITE_CONFIG_TEMP_CACHE_METHODS.scope, { token: admittedToken }),
    ).toThrow(/retired or invalid/);
  });
});
