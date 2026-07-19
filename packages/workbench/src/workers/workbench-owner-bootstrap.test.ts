import { describe, expect, it, vi } from 'vitest';
import type { RuntimeAssetProgress } from '../workbench/errors.ts';
import { inspectProjectDefinition, projects } from '../workbench/project-definition.ts';
import type { ProjectMaterializer } from '../workbench/project-materialization.ts';
import type { OwnerVfsAuthority } from './owner-vfs-authority.ts';
import { withOwnerClose } from './workbench-owner-close.ts';

describe('Workbench owner bootstrap materializer composition', () => {
  it('forwards the exact generic open options object and callback through the close wrapper', async () => {
    const materialized = Object.freeze({
      projectKey: 'progress-options',
      projectRoot: '/workbench/progress-options',
      acquisition: Object.freeze({ kind: 'installed' }),
    });
    const open = vi.fn(
      async (
        _definition: Parameters<ProjectMaterializer['open']>[0],
        _options?: Parameters<ProjectMaterializer['open']>[1],
      ) => materialized,
    );
    const materializer = {
      open,
      delete: vi.fn(async () => undefined),
      cancelActiveAcquisition: vi.fn(),
      close: vi.fn(async () => undefined),
    } satisfies ProjectMaterializer;
    const wrapped = withOwnerClose(
      materializer,
      vi.fn(async () => undefined),
      vi.fn(async () => undefined),
      { flush: vi.fn(async () => undefined) } as unknown as OwnerVfsAuthority,
    );
    const callback = vi.fn((_progress: RuntimeAssetProgress) => undefined);
    const options = Object.freeze({ onRuntimeAssetProgress: callback });
    const definition = inspectProjectDefinition(
      projects.vite({ id: 'progress-options', files: {} }),
    );

    await expect(wrapped.open(definition, options)).resolves.toBe(materialized);

    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]?.[0]).toBe(definition);
    expect(open.mock.calls[0]?.[1]).toBe(options);
    expect(open.mock.calls[0]?.[1]?.onRuntimeAssetProgress).toBe(callback);

    const reason = new Error('owner-local cancellation');
    wrapped.cancelActiveAcquisition(reason);
    expect(materializer.cancelActiveAcquisition).toHaveBeenCalledOnce();
    expect(materializer.cancelActiveAcquisition).toHaveBeenCalledWith(reason);
  });
});
