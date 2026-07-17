/**
 * Socket Lab — the playground preset must fail CI when the socket stack lies.
 *
 * Covers the full user path: selecting the node-server preset, installing real
 * npm `ws`, serving through the SW preview route, then running the lab's own
 * socket probes in the worker that owns the HTTP/WebSocket port registry.
 */
import { type Page, expect, test } from '@playwright/test';
import { expectTerminalContains, pickStarter } from './helpers/playground.ts';

const PORT = 3220;

const EXPECTED_MATRIX: Record<string, { expected: string; probe: string }> = {
  'http-server-loopback': { expected: 'supported', probe: 'auto' },
  'client-request-body-streaming': { expected: 'supported', probe: 'auto' },
  'serverresponse-drain-emission': { expected: 'supported', probe: 'auto' },
  'readable-fromweb-pipe-sink': { expected: 'supported', probe: 'auto' },
  'ws-server-local-upgrade': { expected: 'supported', probe: 'auto' },
  'net-http-framed-server': { expected: 'supported', probe: 'auto' },
  'net/ws-client-external-host': { expected: 'supported', probe: 'manual' },
  'browser-preview-websocket': { expected: 'supported', probe: 'auto' },
  'net-real-tcp-socket-semantics': { expected: 'ceiling', probe: 'auto' },
  'udp-dgram-surface': { expected: 'ceiling', probe: 'auto' },
  'tls-https-surface': { expected: 'not-yet', probe: 'auto' },
  'tls-raw-socket-surface': { expected: 'ceiling', probe: 'auto' },
  'http2-surface': { expected: 'not-yet', probe: 'auto' },
  'stream-web-bridge-surface': { expected: 'not-yet', probe: 'matrix' },
  'cross-realm-preview-unbounded-body': { expected: 'limited', probe: 'matrix' },
  'cross-realm-http-loopback': { expected: 'not-yet', probe: 'matrix' },
  'wasi-socket-syscalls': { expected: 'ceiling', probe: 'matrix' },
};

const EXPECTED_SELF_TESTS: Record<string, string> = {
  'http-server-loopback': 'pass',
  'client-request-body-streaming': 'pass',
  'serverresponse-drain-emission': 'pass',
  'readable-fromweb-pipe-sink': 'pass',
  'ws-server-local-upgrade': 'pass',
  'net-http-framed-server': 'pass',
  'net-real-tcp-socket-semantics': 'expected-error',
  'udp-dgram-surface': 'expected-error',
  'tls-https-surface': 'expected-error',
  'tls-raw-socket-surface': 'expected-error',
  'http2-surface': 'expected-error',
};

test.describe('Socket Lab preset — honest socket capability gate', () => {
  test('boots and verifies supported socket paths plus hard ceilings', async ({ page }) => {
    test.setTimeout(240_000);
    page.on('pageerror', (err) => console.log('[pageerror]', err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') console.log('[console.error]', msg.text());
    });
    await page.goto('/');

    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 15_000,
    });
    // ADR-0165 §9: the gallery lives in the launcher modal now — open the chip,
    // pick the card. The launcher closes on pick and the process's own listening
    // line below proves that boot proceeds.
    await pickStarter(page, 'socket-lab');
    await expectTerminalContains(page, 'socket lab listening on port 3220', 180_000);

    const matrix = await pollJson<{ rows: CapabilityRow[] }>(
      page,
      `/preview/${PORT}/api/capabilities`,
      (value): value is { rows: CapabilityRow[] } => isRecord(value) && Array.isArray(value.rows),
    );
    const matrixById = new Map(matrix.rows.map((row) => [row.id, row]));
    expect([...matrixById.keys()].sort()).toEqual(Object.keys(EXPECTED_MATRIX).sort());
    for (const [id, expected] of Object.entries(EXPECTED_MATRIX)) {
      expect(matrixById.get(id)).toMatchObject(expected);
    }

    const self = await pollJson<{ results: ProbeResult[] }>(
      page,
      `/preview/${PORT}/api/self-test/all`,
      (value): value is { results: ProbeResult[] } =>
        isRecord(value) && Array.isArray(value.results),
      180_000,
    );
    const resultsById = new Map(self.results.map((row) => [row.id, row]));
    expect([...resultsById.keys()].sort()).toEqual(Object.keys(EXPECTED_SELF_TESTS).sort());
    for (const [id, outcome] of Object.entries(EXPECTED_SELF_TESTS)) {
      const row = resultsById.get(id);
      expect(row, id).toBeDefined();
      expect(row?.outcome, `${id}: ${row?.evidence ?? 'missing evidence'}`).toBe(outcome);
      expect(row?.evidence.length).toBeGreaterThan(0);
    }

    const frame = page.frameLocator(`iframe[title="Preview port ${PORT}"]`);
    await expect(frame.locator('h1')).toHaveText('Socket capability matrix', { timeout: 60_000 });
    await expect(frame.locator('.row')).toHaveCount(Object.keys(EXPECTED_MATRIX).length, {
      timeout: 60_000,
    });
    await expect(frame.locator('.row[data-outcome="fail"]')).toHaveCount(0);
    // ADR-0189: the browser-side probe must have genuinely round-tripped (a
    // pending/unrun probe would still show 0 failures).
    await expect(
      frame
        .locator('.row', { hasText: 'Plain preview page native WebSocket' })
        .locator('.row__status'),
    ).toHaveText('verified', { timeout: 30_000 });
    await expect(frame.locator('.summary')).toContainText('failing');
    await expect(frame.locator('.summary')).toContainText('0 failing');
  });
});

interface CapabilityRow {
  readonly id: string;
  readonly expected: string;
  readonly probe: string;
}

interface ProbeResult {
  readonly id: string;
  readonly outcome: string;
  readonly evidence: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function pollJson<T>(
  page: Page,
  path: string,
  accepts: (value: unknown) => value is T,
  timeout = 120_000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  let last = '';
  while (Date.now() < deadline) {
    const probe = await page.evaluate(async (targetPath: string) => {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 5_000);
      try {
        const res = await fetch(targetPath, { cache: 'no-store', signal: ac.signal });
        const body = await res.text();
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = null;
        }
        return { status: res.status, ok: res.ok, body, parsed };
      } catch (err) {
        return {
          status: 0,
          ok: false,
          body: String((err as Error).message ?? err),
          parsed: null,
        };
      } finally {
        clearTimeout(timer);
      }
    }, path);
    last = `${probe.status} ${probe.body.slice(0, 500)}`;
    if (probe.ok && accepts(probe.parsed)) return probe.parsed;
    await page.waitForTimeout(1_000);
  }
  throw new Error(`timed out waiting for JSON from ${path}: ${last}`);
}
