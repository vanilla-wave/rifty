import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createRpcFsSync: vi.fn(),
  createServiceEndpoint: vi.fn(),
  dispatch: vi.fn(),
  readKernelSyncApi: vi.fn(),
  syncCallBinary: vi.fn(),
  syncCall: vi.fn(),
}));

vi.mock('@riftydev/kernel', () => ({
  readKernelSyncApi: mocks.readKernelSyncApi,
}));

vi.mock('./host-fs-rpc.ts', () => ({
  createRpcFsSync: mocks.createRpcFsSync,
}));

vi.mock('./service-endpoint.ts', () => ({
  createServiceEndpoint: mocks.createServiceEndpoint,
}));

interface FakeForkIpcProcess {
  readonly stdout: { write: ReturnType<typeof vi.fn> };
  readonly on: ReturnType<typeof vi.fn>;
  readonly send: ReturnType<typeof vi.fn>;
}

const originalProcess = (globalThis as unknown as { process?: unknown }).process;

function installFakeProcess(): FakeForkIpcProcess {
  const fake: FakeForkIpcProcess = {
    stdout: { write: vi.fn() },
    on: vi.fn(),
    send: vi.fn(),
  };
  (globalThis as unknown as { process?: unknown }).process = fake;
  return fake;
}

function restoreProcess(): void {
  (globalThis as unknown as { process?: unknown }).process = originalProcess;
}

beforeEach(() => {
  vi.resetModules();
  mocks.createRpcFsSync.mockReset();
  mocks.createServiceEndpoint.mockReset();
  mocks.dispatch.mockReset();
  mocks.readKernelSyncApi.mockReset();
  mocks.syncCall.mockReset();
  mocks.syncCallBinary.mockReset();
  mocks.readKernelSyncApi.mockReturnValue({
    call: mocks.syncCall,
    callBinary: mocks.syncCallBinary,
  });
  mocks.createServiceEndpoint.mockReturnValue({ dispatch: mocks.dispatch });
});

afterEach(() => {
  restoreProcess();
});

describe('bootTsLanguageServiceWorker', () => {
  it('is idempotent when an explicit host boot follows auto-boot wiring', async () => {
    const fake = installFakeProcess();
    const { bootTsLanguageServiceWorker } = await import('./entry.ts');

    bootTsLanguageServiceWorker();
    bootTsLanguageServiceWorker();

    restoreProcess();
    expect(mocks.createServiceEndpoint).toHaveBeenCalledTimes(1);
    expect(fake.on).toHaveBeenCalledTimes(1);
    expect(fake.on).toHaveBeenCalledWith('message', expect.any(Function));
    expect(fake.stdout.write).toHaveBeenCalledTimes(1);
  });
});
