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

  it('installs a Vite dev CLI config wrapper for browser HMR and dep-scan ceilings', () => {
    expect(source).toContain('writeViteCliConfigWrapper');
    expect(source).toContain("if (mode === 'dev') writeViteCliConfigWrapper(root, opts)");
    expect(source).toContain('installEsbuildTransformBridge(root)');
    expect(source).toContain('data-rifty-hmr-bridge');
    expect(source).toContain('__riftyActiveViteServer');
    expect(source).toContain('configureServer(server)');
    expect(source).toContain('optimizeDeps');
    expect(source).toContain('noDiscovery: true');
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
