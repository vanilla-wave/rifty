import { NotImplementedError } from '@riftydev/vfs';
import { describe, expect, it } from 'vitest';
import { riftyProcess, writeProcessStdin } from './process.ts';

describe('process.stdin host bridge', () => {
  it('emits string stdin chunks to listeners', () => {
    const chunks: unknown[] = [];
    riftyProcess.stdin.once('data', (chunk) => chunks.push(chunk));

    writeProcessStdin('hello\n');

    expect(chunks).toEqual(['hello\n']);
  });

  it('keeps the no-spec host stdin sibling loud at the same runtime chokepoint', () => {
    const stdin = riftyProcess.stdin as typeof riftyProcess.stdin & { read(): unknown };
    expect(() => stdin.read()).toThrow(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'process.stdin.read',
        message: 'Not implemented: process.stdin.read',
      }),
    );
    expect(() => stdin.read()).toThrow(NotImplementedError);
  });

  it('emits byte chunks unless an encoding is set', () => {
    const chunks: unknown[] = [];
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
  });

  it('decodes utf8 split across stdin chunks', () => {
    const chunks: unknown[] = [];
    riftyProcess.stdin.setEncoding('utf8');
    riftyProcess.stdin.on('data', (chunk) => chunks.push(chunk));

    writeProcessStdin(new Uint8Array([0xe2, 0x82]));
    writeProcessStdin(new Uint8Array([0xac]));

    expect(chunks).toEqual(['€']);
    riftyProcess.stdin.removeAllListeners('data');
  });

  it("treats null as Node's default utf8 encoding and rejects unsupported encodings loudly", () => {
    expect(riftyProcess.stdin.setEncoding(null)).toBe(riftyProcess.stdin);
    expect(() => riftyProcess.stdin.setEncoding('base64')).toThrow(
      /process\.stdin\.setEncoding\('base64'\)/,
    );
  });

  it('buffers host stdin while paused and drains after resume', async () => {
    const chunks: unknown[] = [];

    riftyProcess.stdin.pause();
    writeProcessStdin('early');
    riftyProcess.stdin.once('data', (chunk) => chunks.push(chunk));
    await Promise.resolve();
    expect(chunks).toEqual([]);

    riftyProcess.stdin.resume();

    expect(chunks).toEqual(['early']);
  });
});
