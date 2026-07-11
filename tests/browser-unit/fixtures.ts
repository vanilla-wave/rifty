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
  /** Template to mount (`hidden-empty` default; `vite`/`typescript` carry their real deps). */
  readonly template?: 'hidden-empty' | 'typescript' | 'vite';
  readonly root?: string;
  readonly slug?: string;
  readonly setup?: 'instant' | 'from-scratch';
  readonly starter?: string;
  readonly hiddenEmptyBoot?: boolean;
}

export async function gotoHarness(page: Page): Promise<void> {
  await page.goto('/unit-harness.html');
  await expect(page.locator('#browser-unit-harness')).toHaveAttribute('data-status', 'ready');
}

/** Boot a fresh REAL owner (replacing any previous one on this page); resolves on the ready frame. */
export async function bootOwner(page: Page, opts: BootOwnerOptions): Promise<void> {
  await page.evaluate(async (o) => {
    const [realVite, hiddenEmpty, typescript, vite] = await Promise.all([
      import('/src/glue/realVite.ts'),
      import('/src/templates/hidden-empty.ts'),
      import('/src/templates/typescript.ts'),
      import('/src/templates/vite.ts'),
    ]);
    const logs: string[] = [];
    const handle = realVite.startWorkspaceOwner({
      workspaceId: o.workspaceId,
      root: o.root ?? '/scratch',
      template:
        o.template === 'typescript'
          ? typescript.TYPESCRIPT_TEMPLATE
          : o.template === 'vite'
            ? vite.VITE_TEMPLATE
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
    try {
      await Promise.race([handle.ready, readyTimeout]);
    } catch (error) {
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}; owner logs:\n${logs.slice(-40).join('')}`,
      );
    }
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
export function execLine(page: Page, line: string): Promise<OwnerExecResult> {
  return page.evaluate(async (l) => {
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
      onChunk: (chunk: string) => {
        out += chunk;
      },
    });
    return { exit, out };
  }, line);
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
