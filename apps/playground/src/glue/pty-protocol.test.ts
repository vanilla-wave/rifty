import { describe, expect, it } from 'vitest';
import { type PtyFrame, isOwnerToPage, isPageToOwner } from './pty-protocol.ts';

describe('pty-protocol', () => {
  it('classifies page→owner frames', () => {
    const f: PtyFrame = {
      type: 'pty:exec',
      sid: 's1',
      rid: 'r1',
      line: 'ls',
      cols: 80,
      rows: 24,
      isTTY: true,
    };
    expect(isPageToOwner(f)).toBe(true);
    expect(isOwnerToPage(f)).toBe(false);
  });
  it('classifies owner→page frames', () => {
    const f: PtyFrame = { type: 'pty:exit', sid: 's1', rid: 'r1', code: 0, cwd: '/', env: {} };
    expect(isOwnerToPage(f)).toBe(true);
    expect(isPageToOwner(f)).toBe(false);
  });
  it('chunk frames carry Uint8Array data + monotonic seq shape', () => {
    const f: PtyFrame = {
      type: 'pty:chunk',
      sid: 's',
      rid: 'r',
      stream: 'stdout',
      seq: 0,
      data: new Uint8Array([1]),
    };
    expect(f.data).toBeInstanceOf(Uint8Array);
    expect(isOwnerToPage(f)).toBe(true);
  });
  it('routes pty:dev-server as owner→page', () => {
    const f: PtyFrame = {
      type: 'pty:dev-server',
      status: 'running',
      sid: 'terminal-1',
      port: 5174,
      url: '/preview/5174/',
    };
    expect(isOwnerToPage(f)).toBe(true);
    expect(isPageToOwner(f)).toBe(false);
  });
  it('routes pty:dev-server-req as page→owner', () => {
    const f: PtyFrame = { type: 'pty:dev-server-req' };
    expect(isPageToOwner(f)).toBe(true);
    expect(isOwnerToPage(f)).toBe(false);
  });
  it('routes pty:dev-config as page→owner', () => {
    const f: PtyFrame = {
      type: 'pty:dev-config',
      id: 'dc1',
      templateId: 'express-sqlite',
      slug: 'fullstack',
      setup: 'from-scratch',
    };
    expect(isPageToOwner(f)).toBe(true);
    expect(isOwnerToPage(f)).toBe(false);
  });
  it('routes pty:dev-config-ready as owner→page', () => {
    const f: PtyFrame = { type: 'pty:dev-config-ready', id: 'dc1' };
    expect(isOwnerToPage(f)).toBe(true);
    expect(isPageToOwner(f)).toBe(false);
  });
  it('does not advertise pty:resize — dropped wired no-op; dims stay per-exec (backlog: live-resize)', () => {
    // pty:resize was a fully-wired no-op the owner silently ignored. We removed
    // it from the protocol rather than keep advertising an unimplemented frame.
    // Cast: pty:resize is no longer part of the PtyFrame union.
    expect(isPageToOwner({ type: 'pty:resize' } as unknown as PtyFrame)).toBe(false);
  });
});

describe('pty:preview frames', () => {
  it('classifies pty:preview as owner→page', () => {
    const f: PtyFrame = {
      type: 'pty:preview',
      ports: [{ port: 3000, url: '/preview/3000/', label: 'server.js', source: 'node', sid: 's1' }],
    };
    expect(isOwnerToPage(f)).toBe(true);
    expect(isPageToOwner(f)).toBe(false);
  });
  it('classifies pty:preview-req as page→owner', () => {
    const f: PtyFrame = { type: 'pty:preview-req' };
    expect(isPageToOwner(f)).toBe(true);
    expect(isOwnerToPage(f)).toBe(false);
  });
});
