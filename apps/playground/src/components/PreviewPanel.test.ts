import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./PreviewPanel.tsx', import.meta.url)), 'utf8');

describe('PreviewPanel refresh contract', () => {
  it('does not accept a parent snapshot refresh key', () => {
    expect(source).not.toContain('refreshKey?: number');
    expect(source).not.toContain('props.refreshKey;');
    expect(source).not.toContain('?rf=');
  });

  it('passes the manually selected preview port to the open-tab callback', () => {
    expect(source).toContain('onOpenTab?: (port: number) => void');
    expect(source).toContain('props.onOpenTab(port());');
  });
});
