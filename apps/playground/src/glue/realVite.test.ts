import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./realVite.ts', import.meta.url)), 'utf8');

describe('real Vite page-to-worker updates', () => {
  it('sends VFS updates over kernel worker IPC before falling back to BroadcastChannel', () => {
    expect(source).toContain("handle.send({ type: 'rifty:vfs-write', frame })");
    expect(source).toContain('sendVfsWrite(port, frame)');
  });

  it('shares a preview owner token between the page bridge and worker bridge', () => {
    expect(source).toContain('const ownerToken = createPreviewOwnerToken()');
    expect(source).toContain('RIFTY_PREVIEW_OWNER_TOKEN: ownerToken');
    expect(source).toContain('mountPlaygroundPreviewBridge(previewBridge, { ownerToken })');
  });

  it('exposes the routed port as PORT so node-server entries bind Node-idiomatically', () => {
    // line-anchored: must be the bare PORT env key, not RIFTY_RFV_PORT
    expect(source).toMatch(/\n\s+PORT: String\(port\),/);
  });

  it('bundles the bootstrap as JavaScript before handing it to the kernel worker', () => {
    expect(source).toContain("from '../workers/real-vite-bootstrap.ts?worker&url'");
    expect(source).not.toContain("new URL('../workers/real-vite-bootstrap.ts', import.meta.url)");
  });
});
