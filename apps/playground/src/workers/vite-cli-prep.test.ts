import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./vite-cli-prep.ts', import.meta.url)), 'utf8');

describe('prepareViteCli', () => {
  it('patches Vite CLI async actions into the child keepalive', () => {
    expect(source).toContain('trackKeepalivePromise');
    expect(source).toContain('this.runMatchedCommand();');
    expect(source).toContain('__riftyTrackCliPromise(__riftyAction)');
  });

  it('installs a Vite dev CLI config wrapper for browser HMR', () => {
    expect(source).toContain('writeViteCliConfigWrapper');
    expect(source).toContain("if (mode === 'dev') writeViteCliConfigWrapper(root, opts)");
    expect(source).toContain('data-rifty-hmr-bridge');
    expect(source).toContain('__riftyActiveViteServer');
    expect(source).toContain('configureServer(server)');
  });

  it('installs the host esbuild bridge before the shim overlay, for every CLI mode (ADR-0192)', () => {
    expect(source).toContain("import { installEsbuildBridge } from './esbuild-host.ts'");
    expect(source.indexOf('installEsbuildBridge()')).toBeLessThan(
      source.indexOf('overlayShims(root, mode)'),
    );
  });

  it('dep-discovery suppression is template-gated, never a blanket wrapper default (ADR-0192)', () => {
    // The old unconditional `optimizeDeps: { noDiscovery: true, include: [] }`
    // existed only to dodge the fake esbuild context(). Now the real optimizer
    // runs by default (plugin-react's injected include + discovery pass
    // through); only a template's server.optimizeDepsDisabled opts out.
    expect(source).toMatch(/opts\.noDepDiscovery\s*\n?\s*\?/);
    expect(source.split('noDiscovery: true').length - 1).toBe(1); // gated branch only
    expect(source).toContain(": ''");
  });

  it('patches Vite preview inline config without loading Vite config files', () => {
    expect(source).toContain('VITE_CLI_PREVIEW_NEEDLE');
    expect(source).toContain("mode === 'preview'");
    expect(source).toContain('assertNoUserVitePreviewConfig(root');
    expect(source).toContain('configFile: false');
    expect(source).toContain('allowedHosts: true');
    expect(source).toContain('cors: false');
    expect(source).toContain('TODO(backlog: playground/vite-preview-cors-middleware-parity)');
    expect(source).not.toContain('...objectOrEmpty(user.preview)');
  });
});
