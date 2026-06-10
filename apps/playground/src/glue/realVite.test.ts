import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const source = readFileSync(fileURLToPath(new URL('./realVite.ts', import.meta.url)), 'utf8');

describe('real Vite page-to-worker updates', () => {
  it('sends VFS updates over kernel worker IPC before falling back to BroadcastChannel', () => {
    expect(source).toContain("handle.send({ type: 'rifty:vfs-write', frame })");
    expect(source).toContain('sendVfsWrite(port, frame)');
  });
});
