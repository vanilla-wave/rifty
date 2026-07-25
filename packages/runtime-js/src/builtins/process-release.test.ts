import type { KernelProcessSpec } from '@riftydev/kernel';
import { describe, expect, it } from 'vitest';
import { NODE_PROCESS_IDENTITY } from './process-identity.ts';
import { NodeProcess, riftyProcess } from './process.ts';

interface ProcessRelease {
  name: string;
  extra?: string;
}

function releaseOf(process: NodeProcess): ProcessRelease {
  return (process as NodeProcess & { release: ProcessRelease }).release;
}

function spec(): KernelProcessSpec {
  const stdout = new MessageChannel();
  const stderr = new MessageChannel();
  const stdin = new MessageChannel();
  const ipc = new MessageChannel();
  return {
    pid: 2,
    ppid: 1,
    argv: ['node', '/entry.js'],
    env: {},
    cwd: '/workspace',
    stdio: {
      stdout: stdout.port1,
      stderr: stderr.port1,
      stdin: stdin.port1,
      ipc: ipc.port1,
    },
  };
}

function expectReleaseShape(process: NodeProcess): void {
  const release = releaseOf(process);
  expect(Object.getPrototypeOf(release)).toBe(Object.prototype);
  expect(Object.keys(release)).toEqual(['name']);
  expect(Object.isExtensible(release)).toBe(true);
  expect(Object.isSealed(release)).toBe(false);
  expect(Object.isFrozen(release)).toBe(false);
  expect(Object.getOwnPropertyDescriptor(process, 'release')).toEqual({
    value: release,
    writable: false,
    enumerable: true,
    configurable: true,
  });
  expect(Object.getOwnPropertyDescriptor(release, 'name')).toEqual({
    value: 'node',
    writable: false,
    enumerable: true,
    configurable: true,
  });
  expect('sourceUrl' in release).toBe(false);
  expect('headersUrl' in release).toBe(false);
  expect('libUrl' in release).toBe(false);
  expect('lts' in release).toBe(false);
}

describe('process.release Node compatibility identity (ADR-0322)', () => {
  it('matches the Node 24 custom-build shape for no-spec and spec processes', () => {
    expectReleaseShape(new NodeProcess());
    expectReleaseShape(new NodeProcess(spec()));
  });

  it('keeps release mutation isolated across no-spec, spec, and singleton processes', () => {
    const noSpec = new NodeProcess();
    const firstSpec = new NodeProcess(spec());
    const secondSpec = new NodeProcess(spec());
    const firstRelease = releaseOf(firstSpec);
    const siblings = [releaseOf(noSpec), releaseOf(secondSpec), releaseOf(riftyProcess)];

    expect(new Set([firstRelease, ...siblings]).size).toBe(4);

    expect(() => {
      (firstSpec as unknown as { release: ProcessRelease }).release = { name: 'other' };
    }).toThrow(TypeError);
    expect(() => {
      firstRelease.name = 'other';
    }).toThrow(TypeError);
    expect(Reflect.deleteProperty(firstRelease, 'name')).toBe(true);
    firstRelease.extra = 'local';

    expect(firstRelease).toEqual({ extra: 'local' });
    for (const sibling of siblings) expect(sibling).toEqual({ name: 'node' });
  });

  it('retains rifty host identity beside the Node compatibility axis', () => {
    expect(NODE_PROCESS_IDENTITY.versions.rifty).toBe('0.0.0');
    expect(new NodeProcess().versions.rifty).toBe('0.0.0');
    expect(new NodeProcess(spec()).versions.rifty).toBe('0.0.0');
    expect(riftyProcess.versions.rifty).toBe('0.0.0');
  });

  it('publishes the frozen release seed without sharing a live object', () => {
    const identity = NODE_PROCESS_IDENTITY as typeof NODE_PROCESS_IDENTITY & {
      release: Readonly<{ name: string }>;
    };
    expect(identity.release).toEqual({ name: 'node' });
    expect(Object.isFrozen(identity.release)).toBe(true);
    expect(releaseOf(new NodeProcess())).not.toBe(identity.release);
  });
});
