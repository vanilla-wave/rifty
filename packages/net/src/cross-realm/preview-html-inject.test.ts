import { describe, expect, it } from 'vitest';
import { PREVIEW_WS_BRIDGE_MARKER, injectPreviewWebSocketBridge } from './preview-html-inject.ts';

describe('injectPreviewWebSocketBridge (ADR-0189)', () => {
  it('head-prepends a marker-guarded bridge script carrying the preview-port remap', () => {
    const html = '<!doctype html><html><head><title>t</title></head><body>x</body></html>';
    const out = injectPreviewWebSocketBridge(html);

    const scriptAt = out.indexOf(`<script ${PREVIEW_WS_BRIDGE_MARKER}>`);
    expect(scriptAt).toBeGreaterThan(-1);
    // Before any existing head content, so it runs before framework dev clients.
    expect(scriptAt).toBeLessThan(out.indexOf('<title>'));
    expect(out).toContain('__riftyWebSocketBridgeInstalled');
    expect(out).toContain('/preview/');
    expect(out).toContain('<body>x</body>');
  });

  it('injects into documents without a <head> tag', () => {
    const html = '<html><body>plain</body></html>';
    const out = injectPreviewWebSocketBridge(html);

    expect(out).toContain(`<script ${PREVIEW_WS_BRIDGE_MARKER}>`);
    expect(out.indexOf('<script')).toBeLessThan(out.indexOf('<body>'));
  });

  it('injects into fragment-only bodies (no <html>)', () => {
    const out = injectPreviewWebSocketBridge('<p>bare</p>');

    expect(out.startsWith(`<script ${PREVIEW_WS_BRIDGE_MARKER}>`)).toBe(true);
    expect(out.endsWith('<p>bare</p>')).toBe(true);
  });

  it('is idempotent — marker-guarded against double injection', () => {
    const once = injectPreviewWebSocketBridge('<html><head></head><body></body></html>');
    const twice = injectPreviewWebSocketBridge(once);

    expect(twice).toBe(once);
  });

  it('handles head tags with attributes and mixed case', () => {
    const html = '<HTML><HEAD lang="en"><meta charset="utf-8"></HEAD><body></body></HTML>';
    const out = injectPreviewWebSocketBridge(html);

    const scriptAt = out.indexOf(`<script ${PREVIEW_WS_BRIDGE_MARKER}>`);
    expect(scriptAt).toBeGreaterThan(-1);
    expect(scriptAt).toBeLessThan(out.indexOf('<meta'));
  });
});
