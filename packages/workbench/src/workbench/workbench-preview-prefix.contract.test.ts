/** I5 Contract+RED. Public option authority only; packed boot remains mandatory. */
import { describe, expect, it } from 'vitest';
import { validateUrlContext, validateWorkbenchOptions } from './internal/workbench-options.ts';

const origin = 'https://embed.test';
const context = validateUrlContext({
  apiBaseUrl: `${origin}/sandbox/index.html`,
  clientUrl: `${origin}/sandbox/index.html`,
});
const opaque = 'token=a%20b~c&dup=one&dup=two&blank=&bare&encoded=%2f%2F';
function options(prefix?: unknown) {
  return {
    deployment: {
      workers: {
        owner: './owner.js',
        kernel: './kernel.js',
        node: './node.js',
        devServer: './dev.js',
      },
      serviceWorker: { url: `./sw.js?${opaque}`, scope: '/sandbox/' },
      wasm: { sqlite: './sqlite.wasm' },
      ...(prefix === undefined ? {} : { previewPrefix: prefix }),
    },
    packageAcquisition: { mode: 'snapshot-only' },
    storage: { persistence: 'ephemeral' },
  };
}

describe('I5 Workbench previewPrefix option', () => {
  it('preserves absent-option narrow-scope configurations and exact opaque SW query', () => {
    const validated = validateWorkbenchOptions(options(), context);
    expect(validated.serviceWorker).toEqual({
      url: `${origin}/sandbox/sw.js?${opaque}`,
      scope: `${origin}/sandbox/`,
    });
    const deployment = validated.owner.deployment as unknown as { previewPrefix?: string };
    expect(deployment.previewPrefix ?? '/preview/').toBe('/preview/');
  });

  it('carries one canonical explicit prefix to owner configuration and immutable SW URL', () => {
    const supplied = options('/sandbox/temporary/../preview');
    const validated = validateWorkbenchOptions(supplied, context);
    expect(validated.owner.deployment).toMatchObject({ previewPrefix: '/sandbox/preview/' });
    expect(validated.serviceWorker.url).toBe(
      `${origin}/sandbox/sw.js?${opaque}&__rifty_preview_prefix=%2Fsandbox%2Fpreview%2F`,
    );
    expect(Object.isFrozen(validated.owner.deployment)).toBe(true);
    expect(supplied.deployment.serviceWorker.url).toBe(`./sw.js?${opaque}`);
  });

  it.each([
    '/preview/',
    '/sandbox-other/p/',
    '/sandbox/../outside/',
    '/sandbox/%2e%2e/outside/',
    '//other.test/sandbox/p/',
    'relative/',
    '/sandbox/p?x',
    '/sandbox/p#x',
    '/sandbox/p%2f/',
    '/sandbox/p\\x/',
    '/sandbox/p\t/',
    null,
    false,
  ])('rejects explicit invalid/out-of-scope configuration %j', (prefix) => {
    expect(() => validateWorkbenchOptions(options(prefix), context)).toThrow(/previewPrefix/);
  });

  it('does not replace a caller-owned reserved query field', () => {
    const supplied = options('/sandbox/p/');
    supplied.deployment.serviceWorker.url = './sw.js?keep=%20&__rifty_preview_prefix=caller';
    expect(() => validateWorkbenchOptions(supplied, context)).toThrow(
      /previewPrefix|preview.prefix/i,
    );
    expect(supplied.deployment.serviceWorker.url).toBe(
      './sw.js?keep=%20&__rifty_preview_prefix=caller',
    );
  });
});
