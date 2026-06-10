import { describe, expect, it } from 'vitest';
import { riftyProcess, writeProcessStdin } from './process.ts';

describe('process.stdin host bridge', () => {
  it('emits string stdin chunks to listeners', () => {
    const chunks: unknown[] = [];
    riftyProcess.stdin.once('data', (chunk) => chunks.push(chunk));

    writeProcessStdin('hello\n');

    expect(chunks).toEqual(['hello\n']);
  });

  it('emits byte chunks unless an encoding is set', () => {
    const chunks: unknown[] = [];
    riftyProcess.stdin.setEncoding(null);
    riftyProcess.stdin.once('data', (chunk) => chunks.push(chunk));

    const bytes = new Uint8Array([0x68, 0x69]);
    writeProcessStdin(bytes);

    expect(chunks).toEqual([bytes]);
  });

  it('decodes byte chunks when utf8 encoding is requested', () => {
    const chunks: unknown[] = [];
    riftyProcess.stdin.setEncoding('utf8');
    riftyProcess.stdin.once('data', (chunk) => chunks.push(chunk));

    writeProcessStdin(new Uint8Array([0xe2, 0x9c, 0x93]));

    expect(chunks).toEqual(['✓']);
    riftyProcess.stdin.setEncoding(null);
  });

  it('decodes utf8 split across stdin chunks', () => {
    const chunks: unknown[] = [];
    riftyProcess.stdin.setEncoding('utf8');
    riftyProcess.stdin.on('data', (chunk) => chunks.push(chunk));

    writeProcessStdin(new Uint8Array([0xe2, 0x82]));
    writeProcessStdin(new Uint8Array([0xac]));

    expect(chunks).toEqual(['€']);
    riftyProcess.stdin.removeAllListeners('data');
    riftyProcess.stdin.setEncoding(null);
  });

  it('buffers stdin until a data listener is attached', async () => {
    const chunks: unknown[] = [];

    writeProcessStdin('early');
    riftyProcess.stdin.once('data', (chunk) => chunks.push(chunk));
    await Promise.resolve();

    expect(chunks).toEqual(['early']);
  });
});
