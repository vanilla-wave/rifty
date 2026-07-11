import { type Page, expect } from '@playwright/test';

/**
 * Shared browser-unit fixture helpers (ADR-0196). Boot the REAL workspace-owner
 * worker inside the thin harness page and drive it from specs. evaluate bodies
 * are serialized, so the live handle is parked on `window.__buOwner` — every
 * helper re-reads it there. Worker console is NOT captured by playwright: owner
 * stdout/stderr routes through onLog into `window.__buLogs` and the log tail is
 * attached to boot-timeout errors.
 */

interface OwnerExecResult {
  readonly exit: number;
  readonly out: string;
}

export interface BootOwnerOptions {
  readonly workspaceId: string;
  /** Template to mount ('hidden-empty' default; 'typescript' has real deps + node_modules seeds). */
  readonly template?: 'hidden-empty' | 'typescript';
  readonly root?: string;
  readonly slug?: string;
  readonly setup?: 'instant' | 'from-scratch';
  readonly starter?: string;
  readonly hiddenEmptyBoot?: boolean;
}

export interface OwnerProjectIndexSnapshot {
  readonly activeId: string;
  readonly scratch: { readonly starter: string; readonly dirty: boolean } | null;
}

export async function gotoHarness(page: Page): Promise<void> {
  await page.goto('/unit-harness.html');
  await expect(page.locator('#browser-unit-harness')).toHaveAttribute('data-status', 'ready');
}

/** Boot a fresh REAL owner (replacing any previous one on this page); resolves on the ready frame. */
export async function bootOwner(page: Page, opts: BootOwnerOptions): Promise<void> {
  await page.evaluate(async (o) => {
    const [realVite, hiddenEmpty, typescript] = await Promise.all([
      import('/src/glue/realVite.ts'),
      import('/src/templates/hidden-empty.ts'),
      import('/src/templates/typescript.ts'),
    ]);
    const logs: string[] = [];
    const handle = realVite.startWorkspaceOwner({
      workspaceId: o.workspaceId,
      root: o.root ?? '/scratch',
      template:
        o.template === 'typescript'
          ? typescript.TYPESCRIPT_TEMPLATE
          : hiddenEmpty.HIDDEN_EMPTY_TEMPLATE,
      slug: o.slug ?? 'scratch',
      setup: o.setup ?? 'instant',
      ...(o.starter === undefined ? {} : { starter: o.starter }),
      hiddenEmptyBoot: o.hiddenEmptyBoot ?? true,
      onLog: (line: string) => logs.push(line),
    });
    const readyTimeout = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(`owner ready timed out (60s); owner logs:\n${logs.slice(-40).join('')}`),
          ),
        60_000,
      );
    });
    await Promise.race([handle.ready, readyTimeout]);
    const w = window as unknown as { __buOwner?: unknown; __buLogs?: string[]; __buSid?: string };
    w.__buOwner = handle;
    w.__buLogs = logs;
    w.__buSid = undefined;
  }, opts);
}

/** Owner onLog lines captured since boot. */
export function ownerLogs(page: Page): Promise<string> {
  return page.evaluate(() => {
    const w = window as unknown as { __buLogs?: string[] };
    return (w.__buLogs ?? []).join('');
  });
}

/** Run one shell line in a lazily-opened pty session of the current owner. */
export function execLine(
  page: Page,
  line: string,
  origin: 'boot' | 'user' = 'user',
): Promise<OwnerExecResult> {
  return page.evaluate(
    async ({ line: l, origin: runOrigin }) => {
      const w = window as unknown as {
        __buOwner?: {
          openSession(sid: string): Promise<void>;
          exec(
            sid: string,
            line: string,
            opts: {
              cols: number;
              rows: number;
              isTTY: boolean;
              origin: 'boot' | 'user';
              onChunk: (chunk: string) => void;
            },
          ): Promise<number>;
        };
        __buSid?: string;
      };
      const handle = w.__buOwner;
      if (!handle) throw new Error('execLine: no owner booted on this page');
      if (!w.__buSid) {
        w.__buSid = `bu-${Date.now().toString(36)}`;
        await handle.openSession(w.__buSid);
      }
      let out = '';
      const exit = await handle.exec(w.__buSid, l, {
        cols: 120,
        rows: 24,
        isTTY: false,
        origin: runOrigin,
        onChunk: (chunk: string) => {
          out += chunk;
        },
      });
      return { exit, out };
    },
    { line, origin },
  );
}

/** writeFrameAcked a UTF-8 file into the owner tree. */
export async function writeOwnerFile(page: Page, path: string, content: string): Promise<void> {
  await page.evaluate(
    async (f) => {
      const w = window as unknown as {
        __buOwner?: {
          writeFrameAcked(frame: { type: 'write'; path: string; data: Uint8Array }): Promise<void>;
        };
      };
      if (!w.__buOwner) throw new Error('writeOwnerFile: no owner booted on this page');
      await w.__buOwner.writeFrameAcked({
        type: 'write',
        path: f.path,
        data: new TextEncoder().encode(f.content),
      });
    },
    { path, content },
  );
}

/** Durability barrier: drain the owner's OPFS write-through (ADR-0187) —
 *  resolves only when the durable tier is clean, rejects on persist failures.
 *  The deterministic replacement for a sleep before killing the owner. */
export async function flushOwnerDurable(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const w = window as unknown as { __buOwner?: { flushDurable(): Promise<void> } };
    if (!w.__buOwner) throw new Error('flushOwnerDurable: no owner booted on this page');
    await w.__buOwner.flushDurable();
  });
}

/** readFileBytes decoded to text; never throws — missing files report ok:false. */
export function readOwnerFile(
  page: Page,
  path: string,
): Promise<{ ok: boolean; text: string; error: string }> {
  return page.evaluate(async (p) => {
    const w = window as unknown as {
      __buOwner?: { readFileBytes(path: string): Promise<Uint8Array> };
    };
    if (!w.__buOwner) throw new Error('readOwnerFile: no owner booted on this page');
    try {
      const bytes = await w.__buOwner.readFileBytes(p);
      return { ok: true, text: new TextDecoder().decode(bytes), error: '' };
    } catch (err) {
      return { ok: false, text: '', error: err instanceof Error ? err.message : String(err) };
    }
  }, path);
}

/** Read the current owner-served project index through its real bridge. */
export function readOwnerProjectIndex(page: Page): Promise<OwnerProjectIndexSnapshot> {
  return page.evaluate(async () => {
    const w = window as unknown as { __buOwner?: { snapshotPort: string | number } };
    if (!w.__buOwner) throw new Error('readOwnerProjectIndex: no owner booted on this page');
    const { bridgeProjectIndex } = await import('/src/glue/project-index-port.ts');
    const mirror = bridgeProjectIndex(w.__buOwner.snapshotPort);
    try {
      return await new Promise<OwnerProjectIndexSnapshot>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('project index read timed out')), 10_000);
        const unsubscribe = mirror.subscribe((index) => {
          clearTimeout(timer);
          unsubscribe();
          resolve(index);
        });
      });
    } finally {
      mirror.dispose();
    }
  });
}

/** Tell the owner the active preset dev config (pty:dev-config round-trip). */
export async function setDevConfig(
  page: Page,
  config: { templateId: string; slug: string; setup: 'instant' | 'from-scratch' },
): Promise<void> {
  await page.evaluate(async (c) => {
    const w = window as unknown as {
      __buOwner?: {
        setDevConfig(config: {
          templateId: string;
          slug: string;
          setup: 'instant' | 'from-scratch';
        }): Promise<void>;
      };
    };
    if (!w.__buOwner) throw new Error('setDevConfig: no owner booted on this page');
    await w.__buOwner.setDevConfig(c);
  }, config);
}

/** Kill the current owner and await its exit. */
export async function closeOwner(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const w = window as unknown as {
      __buOwner?: { close(): void; closed: Promise<number | null> };
      __buSid?: string;
    };
    if (!w.__buOwner) return;
    w.__buOwner.close();
    await w.__buOwner.closed;
    w.__buOwner = undefined;
    w.__buSid = undefined;
  });
}
