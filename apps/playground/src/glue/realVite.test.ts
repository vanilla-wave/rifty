import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./realVite.ts', import.meta.url)), 'utf8');

describe('real Vite page-to-owner updates (ADR-0148 P4)', () => {
  it('sends VFS updates over kernel worker IPC before falling back to BroadcastChannel', () => {
    // The page seeds/writes the OWNER store via the owner handle's writeFile.
    expect(source).toContain("worker.send({ type: 'rifty:vfs-write', frame })");
    expect(source).toContain('sendVfsWrite(snapshotPort, frame)');
  });

  it('shares a preview owner token between the page bridge and worker bridge', () => {
    // The owner generates the token, carries it to the worker via env, and the
    // page wires its preview bridge side with the SAME token (`wirePreviewBridge`).
    expect(source).toContain('const previewOwnerToken = createPreviewOwnerToken()');
    expect(source).toContain('RIFTY_PREVIEW_OWNER_TOKEN: previewOwnerToken');
    expect(source).toContain('mountPlaygroundPreviewBridge(previewBridge, { ownerToken })');
  });

  it('exposes the routed port as PORT so node-server entries bind Node-idiomatically', () => {
    // line-anchored: the bare PORT env key (= the template dev port), not RIFTY_RFV_PORT
    expect(source).toMatch(/\n\s+PORT: String\(template\.defaultPort\),/);
  });

  it('bundles the bootstrap as JavaScript before handing it to the kernel worker', () => {
    expect(source).toContain("from '../workers/real-vite-bootstrap.ts?worker&url'");
    expect(source).not.toContain("new URL('../workers/real-vite-bootstrap.ts', import.meta.url)");
  });
});
