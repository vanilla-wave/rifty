import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./realVite.ts', import.meta.url)), 'utf8');

describe('real Vite page-to-owner updates (ADR-0148: co-resident dev server runs inside the owner)', () => {
  it('sends VFS updates over kernel worker IPC before falling back to BroadcastChannel', () => {
    // The page seeds/writes the OWNER store via the owner handle's writeFile.
    expect(source).toContain("worker.send({ type: 'rifty:vfs-write', frame })");
    expect(source).toContain('sendVfsWrite(snapshotPort, frame)');
  });

  it('keys the page-side preview bridge on a generated owner token', () => {
    // ADR-0150 P6b: the dev server runs in a supervised child whose cross-realm
    // route is keyed by port, so the preview SW token is generated + wired
    // page-side only (no longer threaded to the owner/worker via env).
    expect(source).toContain('const previewOwnerToken = createPreviewOwnerToken()');
    expect(source).toContain(
      'mountPlaygroundPreviewBridge(previewBridge, { ownerToken, ports: [port] })',
    );
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
