import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SW_ROUTING_VERSION } from '../src/protocol.ts';

const protocolSource = readFileSync(
  fileURLToPath(new URL('../src/protocol.ts', import.meta.url)),
  'utf8',
);
const readmeSource = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');

describe('preview routing docs', () => {
  it('do not document Client.url recovery for unknown root-origin requests', () => {
    expect(protocolSource).not.toContain('Client.url');
    expect(readmeSource).not.toContain('Client.url');
  });

  it('bumps the routing version for the localhost-Host synthesizePreviewUrl shape (ADR-0189 D3)', () => {
    expect(SW_ROUTING_VERSION).toBe('6');
    expect(protocolSource).toContain('`synthesizePreviewUrl(path, port?)`');
  });
});
