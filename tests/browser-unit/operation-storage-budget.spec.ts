import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

const workspacePath = process.cwd().replaceAll('\\', '/');
const workerModuleUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/operation-storage-budget-worker.ts?worker&url`;
interface Request {
  readonly kind: 'drain' | 'owner-proof' | 'storage-proof';
  readonly timeoutMs?: number;
  readonly boundary?: 'close' | 'read' | 'cleanup';
}
interface Observation {
  readonly state: string;
  readonly value?: {
    readonly total: number;
    readonly failures: readonly { readonly message: string }[];
  };
}
interface DrainResult {
  readonly checks: Readonly<
    Record<
      string,
      {
        readonly flush: Observation;
        readonly writes: readonly string[];
        readonly closes: readonly string[];
      }
    >
  >;
  readonly healed: { readonly total: number };
  readonly persisted: { readonly samePath: string; readonly capacity: string };
  readonly writes: readonly string[];
  readonly closes: readonly string[];
}
interface ProofResult {
  readonly at30: Observation;
  readonly final: Observation;
  readonly storage: {
    readonly policy: string;
    readonly backend: string;
    readonly durability: string;
    readonly fallback?: { readonly reason: string };
  };
  readonly nativeReads: readonly { readonly path: string; readonly text: string }[];
  readonly nativeWrites: readonly string[];
}
const cases: readonly { readonly name: string; readonly request: Request }[] = [
  {
    name: 'explicit 90s native report survives 30s, retains fences and heals late',
    request: { kind: 'drain', timeoutMs: 90000 },
  },
  { name: 'omitted native report retains 30s default', request: { kind: 'drain' } },
  {
    name: 'explicit 10s native report controls existing active timer',
    request: { kind: 'drain', timeoutMs: 10000 },
  },
  ...(['close', 'read', 'cleanup'] as const).map((boundary) => ({
    name: `public B90 reaches native proof ${boundary}`,
    request: { kind: 'owner-proof' as const, timeoutMs: 90000, boundary },
  })),
  {
    name: 'omitted B retains 30s persisted-read proof fallback',
    request: { kind: 'owner-proof', boundary: 'read' },
  },
  {
    name: 'default storage installer forwards shared ioReport90',
    request: { kind: 'storage-proof', boundary: 'close' },
  },
];

for (const { name, request } of cases) {
  test(`I7 ${name}`, async ({ page }) => {
    await gotoHarness(page);
    const reply = await page.evaluate(
      async ({ moduleUrl, request }): Promise<DrainResult | ProofResult> => {
        const imported = (await import(/* @vite-ignore */ moduleUrl)) as {
          readonly default: string;
        };
        const worker = new Worker(imported.default, { type: 'module' });
        try {
          return await new Promise((resolve, reject) => {
            worker.onmessage = (
              event: MessageEvent<
                | { readonly ok: true; readonly result: DrainResult | ProofResult }
                | { readonly ok: false; readonly error: string }
              >,
            ) => {
              if (event.data.ok) resolve(event.data.result);
              else reject(new Error(event.data.error));
            };
            worker.onerror = (event) => reject(new Error(event.message));
            worker.postMessage(request);
          });
        } finally {
          worker.terminate();
        }
      },
      { moduleUrl: workerModuleUrl, request },
    );
    console.log(`I7 native budget ${JSON.stringify({ request, reply })}`);
    if (request.kind === 'drain') {
      const result = reply as DrainResult;
      const budget = request.timeoutMs ?? 30000;
      const at = (time: number) => {
        const observed = result.checks[String(time)];
        if (observed === undefined) throw new Error(`Missing native clock observation ${time}`);
        return observed;
      };
      expect(at(Math.min(29999, budget - 1)).flush.state).toBe('pending');
      if (budget === 90000) {
        expect(at(30001).flush.state, 'hidden30s must not cut off explicit90s').toBe('pending');
        expect(at(89999).flush.state).toBe('pending');
      }
      const expired = at(budget);
      expect(expired.flush.state).toBe('resolved');
      expect(expired.flush.value?.total).toBe(17);
      expect(expired.flush.value?.failures.map((failure) => failure.message).join('; ')).toMatch(
        new RegExp(`${budget}ms`),
      );
      expect(expired.writes).toHaveLength(16);
      expect(expired.closes).toHaveLength(0);
      expect(at(90000).writes).toHaveLength(16);
      expect(result.healed.total).toBe(0);
      expect(result.persisted).toEqual({ samePath: 'second-0', capacity: 'capacity' });
      expect(result.writes).toHaveLength(18);
      expect(result.closes).toHaveLength(18);
      expect(result.writes.filter((path) => path.endsWith('/hold-0.bin'))).toHaveLength(2);
    } else {
      const result = reply as ProofResult;
      if (request.kind === 'owner-proof' && request.timeoutMs === undefined) {
        expect(result.at30.state).toBe('resolved');
        expect(result.storage.backend).toBe('memory');
        expect(result.storage.durability).toBe('ephemeral');
        expect(result.storage.fallback?.reason).toMatch(/persisted read timed out after 30000ms/);
      } else {
        expect(result.at30.state, 'hidden30s proof/report must not cut off raised config').toBe(
          'pending',
        );
        expect(result.final.state).toBe('resolved');
        expect(result.storage).toEqual({
          policy: 'preferred',
          backend: 'opfs',
          durability: 'durable',
        });
        const reads = result.nativeReads.filter((read) => read.path.includes('/storage-proof/'));
        expect(reads.length).toBeGreaterThanOrEqual(1);
        for (const read of reads)
          expect(read.text).toBe(`workbench-owner-storage-proof-v1:${read.path.split('/').at(-1)}`);
        expect(result.nativeWrites.filter((path) => path.includes('/storage-proof/'))).toHaveLength(
          1,
        );
      }
    }
  });
}
