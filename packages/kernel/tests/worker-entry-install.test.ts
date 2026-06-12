import { describe, expect, it } from 'vitest';
import { installWorkerEntry } from '../src/worker-entry.ts';

class StubWorkerTarget {
  readonly listeners: EventListener[] = [];

  addEventListener(type: string, listener: EventListener): void {
    if (type === 'message') this.listeners.push(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    if (type !== 'message') return;
    const index = this.listeners.indexOf(listener);
    if (index !== -1) this.listeners.splice(index, 1);
  }
}

describe('installWorkerEntry', () => {
  it('installs at most one init listener per worker target', () => {
    const target = new StubWorkerTarget();

    installWorkerEntry(target as unknown as DedicatedWorkerGlobalScope);
    installWorkerEntry(target as unknown as DedicatedWorkerGlobalScope);

    expect(target.listeners).toHaveLength(1);
  });
});
