import { describe, expect, it } from 'vitest';
import { NodeProcess } from './process.ts';

describe('process.stdin host bridge', () => {
  it('emits string stdin chunks to listeners', async () => {
    const process = new NodeProcess();
    const chunks: unknown[] = [];
    process.stdin.once('data', (chunk) => chunks.push(chunk));

    process.pushStdin('hello\n');
    await Promise.resolve();

    expect(chunks).toEqual(['hello\n']);
  });

  it('emits byte chunks unless an encoding is set', async () => {
    const process = new NodeProcess();
    const chunks: unknown[] = [];
    process.stdin.once('data', (chunk) => chunks.push(chunk));

    const bytes = new Uint8Array([0x68, 0x69]);
    process.pushStdin(bytes);
    await Promise.resolve();

    expect(chunks).toEqual([bytes]);
  });

  it('decodes byte chunks when utf8 encoding is requested', async () => {
    const process = new NodeProcess();
    const chunks: unknown[] = [];
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', (chunk) => chunks.push(chunk));

    process.pushStdin(new Uint8Array([0xe2, 0x9c, 0x93]));
    await Promise.resolve();

    expect(chunks).toEqual(['✓']);
  });

  it('decodes utf8 split across stdin chunks', async () => {
    const process = new NodeProcess();
    const chunks: unknown[] = [];
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => chunks.push(chunk));

    process.pushStdin(new Uint8Array([0xe2, 0x82]));
    process.pushStdin(new Uint8Array([0xac]));
    await Promise.resolve();

    expect(chunks).toEqual(['€']);
  });

  it('buffers stdin until a data listener is attached', async () => {
    const process = new NodeProcess();
    const chunks: unknown[] = [];

    process.pushStdin('early');
    process.stdin.once('data', (chunk) => chunks.push(chunk));
    await Promise.resolve();

    expect(chunks).toEqual(['early']);
  });
});
