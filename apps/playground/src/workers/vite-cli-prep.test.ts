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

  it('installs a Vite dev CLI config wrapper for forced options + the server handle (stock HMR, ADR-0189)', () => {
    expect(source).toContain('writeViteCliConfigWrapper');
    expect(source).toContain("if (mode === 'dev') writeViteCliConfigWrapper(root, opts)");
    expect(source).toContain('installEsbuildTransformBridge(root)');
    expect(source).toContain('__riftyActiveViteServer');
    expect(source).toContain('configureServer(server)');
    expect(source).toContain('optimizeDeps');
    expect(source).toContain('noDiscovery: true');
    // The HMR endpoint rewrite + client-script injection died with ADR-0189:
    // stock `server.hmr` flows through the generic preview bridge; only
    // ADR-0161 (Vite 8) still forces hmr:false via `hmrOff`.
    expect(source).not.toContain('data-rifty-hmr-bridge');
    expect(source).not.toContain('viteHmrClientScript');
    expect(source).not.toContain('clientPort');
    expect(source).toContain('hmrOff');
    expect(source).toContain('hmr: false');
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

  it('carries zero shim glue — internals shims are applied at install time (ADR-0188)', () => {
    // Only the vite CLI runtime patches (keepalive + preview inline config)
    // remain here; package-content substitution is the installer's job.
    expect(source).not.toContain('overlayShims');
    expect(source).not.toContain('reRootShimPath');
    expect(source).not.toContain('ShimFiles');
  });
});
