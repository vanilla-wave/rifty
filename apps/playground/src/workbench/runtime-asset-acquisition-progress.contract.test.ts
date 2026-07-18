import { describe, expect, it, vi } from 'vitest';
import { RuntimeAssetError, deserializeWorkbenchOwnerError } from './errors.ts';
import { ownPlaygroundProjectOpenOptions } from './internal/playground-terminal-state.ts';
import { inspectWorkbenchOwnerToPageMessage } from './owner-protocol.ts';

const REQUIRED_SET_DIGEST = 'a'.repeat(64);

describe('runtime-asset acquisition public progress contract', () => {
  it('owns the page callback with the companion options instead of rejecting or cloning it', () => {
    const onRuntimeAssetProgress = vi.fn();

    const owned = ownPlaygroundProjectOpenOptions({
      initialTerminalState: { cwd: '/', env: { TERM: 'xterm-256color' } },
      onRuntimeAssetProgress,
    }) as Readonly<{
      initialTerminalState: Readonly<{
        cwd: string;
        env: Readonly<Record<string, string>>;
      }>;
      onRuntimeAssetProgress: typeof onRuntimeAssetProgress;
    }>;

    expect(owned.onRuntimeAssetProgress).toBe(onRuntimeAssetProgress);
    expect(owned.initialTerminalState).toEqual({
      cwd: '/',
      env: { TERM: 'xterm-256color' },
    });
    expect(Object.isFrozen(owned)).toBe(true);
  });

  it('decodes one exact non-terminal owner progress frame for the matching open operation', () => {
    const progress = Object.freeze({
      phase: 'verify' as const,
      assetId: 'esbuild-wasm@0.28.0/package/esbuild.wasm',
      assetIndex: 0,
      assetCount: 1,
    });

    expect(
      inspectWorkbenchOwnerToPageMessage({
        type: 'workbench:runtime-assets-progress',
        opId: 'open:17',
        progress,
      }),
    ).toEqual({
      type: 'workbench:runtime-assets-progress',
      opId: 'open:17',
      progress,
    });
  });

  it('decodes acknowledged ready only after storage and keeps the storage class semantic', () => {
    expect(
      inspectWorkbenchOwnerToPageMessage({
        type: 'workbench:runtime-assets-progress',
        opId: 'open:18',
        progress: {
          phase: 'ready',
          requiredSetDigest: REQUIRED_SET_DIGEST,
          assetCount: 1,
          storageClass: 'opfs-best-effort',
        },
      }),
    ).toEqual({
      type: 'workbench:runtime-assets-progress',
      opId: 'open:18',
      progress: {
        phase: 'ready',
        requiredSetDigest: REQUIRED_SET_DIGEST,
        assetCount: 1,
        storageClass: 'opfs-best-effort',
      },
    });
  });

  it('keeps the owner failure projection nominal, fixed-message, and free of internals', () => {
    const decoded = inspectWorkbenchOwnerToPageMessage({
      type: 'workbench:failure',
      opId: 'open:19',
      error: {
        name: 'RuntimeAssetError',
        code: 'ESHADOWASSET',
        message: 'Runtime asset verification failed',
        phase: 'verify',
        recovery: 'clear-and-retry',
        requiredSetDigest: REQUIRED_SET_DIGEST,
        assetId: 'esbuild-wasm@0.28.0/package/esbuild.wasm',
      },
    });

    expect(decoded).toEqual({
      type: 'workbench:failure',
      opId: 'open:19',
      error: {
        name: 'RuntimeAssetError',
        code: 'ESHADOWASSET',
        message: 'Runtime asset verification failed',
        phase: 'verify',
        recovery: 'clear-and-retry',
        requiredSetDigest: REQUIRED_SET_DIGEST,
        assetId: 'esbuild-wasm@0.28.0/package/esbuild.wasm',
      },
    });
    if (decoded.type !== 'workbench:failure') throw new Error('expected failure frame');
    const restored = deserializeWorkbenchOwnerError(decoded.error);
    expect(restored).toBeInstanceOf(RuntimeAssetError);
    expect(restored).not.toHaveProperty('cause');
    expect(restored).not.toHaveProperty('stackUrl');
  });
});
