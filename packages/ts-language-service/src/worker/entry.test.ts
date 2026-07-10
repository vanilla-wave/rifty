import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createRpcFsSync: vi.fn(),
  createServiceEndpoint: vi.fn(),
  dispatch: vi.fn(),
  controlOnMessage: vi.fn(),
  controlSend: vi.fn(),
  readWorkerControlChannel: vi.fn(),
  readKernelSyncApi: vi.fn(),
  syncCall: vi.fn(),
}));

vi.mock('@riftydev/kernel', () => ({
  readKernelSyncApi: mocks.readKernelSyncApi,
  readWorkerControlChannel: mocks.readWorkerControlChannel,
}));

vi.mock('./host-fs-rpc.ts', () => ({
  createRpcFsSync: mocks.createRpcFsSync,
}));

vi.mock('./service-endpoint.ts', () => ({
  createServiceEndpoint: mocks.createServiceEndpoint,
}));

interface FakeWorkerProcess {
  readonly stdout: { write: ReturnType<typeof vi.fn> };
}

const originalProcess = (globalThis as unknown as { process?: unknown }).process;

function installFakeProcess(): FakeWorkerProcess {
  const fake: FakeWorkerProcess = {
    stdout: { write: vi.fn() },
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
  mocks.controlOnMessage.mockReset();
  mocks.controlSend.mockReset();
  mocks.readWorkerControlChannel.mockReset();
  mocks.readKernelSyncApi.mockReset();
  mocks.syncCall.mockReset();
  mocks.readKernelSyncApi.mockReturnValue({ call: mocks.syncCall });
  mocks.readWorkerControlChannel.mockReturnValue({
    onMessage: mocks.controlOnMessage,
    send: mocks.controlSend,
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
    expect(mocks.controlOnMessage).toHaveBeenCalledTimes(1);
    expect(mocks.controlOnMessage).toHaveBeenCalledWith(expect.any(Function));
    expect(fake.stdout.write).toHaveBeenCalledTimes(1);
  });
});
