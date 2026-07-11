import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

const INITIAL_MARKER = 'workbench-public-v1';
const UPDATED_MARKER = 'workbench-public-v2';
const ENTRY_PATH = '/public-workbench/src/main.js';

test('public workbench session boots and drives a real Vite project through every controller', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await gotoHarness(page);

  const boot = await page.evaluate(
    async ({ entryPath, initialMarker }) => {
      const host = await import('/src/browser-unit/workbench-session-harness.ts');
      const logs: string[] = [];
      const session = host.createBrowserUnitWorkbenchSession({
        workspaceId: `browser-unit-public-${Date.now().toString(36)}`,
        root: entryPath.slice(0, entryPath.indexOf('/src/')),
        marker: initialMarker,
        onLog: (line: string) => logs.push(line),
      });
      const controllers = await session.boot();

      const waitUntil = async (predicate: () => boolean, label: string, timeoutMs: number) => {
        const deadline = performance.now() + timeoutMs;
        while (!predicate()) {
          if (performance.now() >= deadline) {
            throw new Error(`${label} timed out; owner logs:\n${logs.slice(-80).join('')}`);
          }
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      };

      await waitUntil(
        () =>
          controllers.files.snapshot().ready &&
          controllers.files.snapshot().entries.some((entry) => entry.path === entryPath),
        'initial file snapshot',
        15_000,
      );

      const root = entryPath.slice(0, entryPath.indexOf('/src/'));
      const createdPath = `${root}/src/controller-resize-probe.mjs`;
      const renamedPath = `${root}/src/controller-resize-probe-renamed.mjs`;
      const stdinProbePath = `${root}/src/controller-stdin-probe.mjs`;
      const resizeProbeSource = `const keepAlive = setInterval(() => {}, 1_000);
process.stdout.write(\`initial:\${process.stdout.columns}x\${process.stdout.rows}\\n\`);
process.on('SIGWINCH', () => {
  process.stdout.write(\`resize:\${process.stdout.columns}x\${process.stdout.rows}\\n\`);
  clearInterval(keepAlive);
});
`;
      const stdinProbeSource = `process.stdin.setEncoding('utf8');
process.stdout.write('stdin:ready\\n');
const chunk = await new Promise((resolve) => process.stdin.once('data', resolve));
process.stdout.write(\`stdin:\${chunk}\`);
process.exit(0);
`;
      const watchedSnapshots: {
        readonly revision: number;
        readonly pendingMutations: number;
        readonly durable: boolean;
        readonly paths: readonly string[];
      }[] = [];
      const stopWatchingFiles = controllers.files.watch((snapshot) => {
        watchedSnapshots.push({
          revision: snapshot.revision,
          pendingMutations: snapshot.pendingMutations,
          durable: snapshot.durable,
          paths: snapshot.entries.map((entry) => entry.path),
        });
      });

      await controllers.files.createFile(createdPath, resizeProbeSource);
      const afterCreate = controllers.files.snapshot();
      const createdEntry = afterCreate.entries.find((entry) => entry.path === createdPath);
      await controllers.files.rename(createdPath, renamedPath);
      const afterRename = controllers.files.snapshot();
      const renamedEntry = afterRename.entries.find((entry) => entry.path === renamedPath);

      const resizeSession = controllers.terminal.createSession('SIGWINCH probe');
      const resizeChunks: string[] = [];
      const detachResize = controllers.terminal.attach(resizeSession.id, (chunk) => {
        resizeChunks.push(chunk);
      });
      let resizeExit: number | null = null;
      const resizeRun = controllers.terminal.run(
        resizeSession.id,
        `cd ${root} && node src/controller-resize-probe-renamed.mjs`,
        { cols: 80, rows: 24 },
      );
      void resizeRun.then((code) => {
        resizeExit = code;
      });
      await waitUntil(
        () => {
          if (resizeExit !== null) {
            throw new Error(
              `resize probe exited before resize (${resizeExit}); terminal:\n${resizeChunks.join('')}`,
            );
          }
          return resizeChunks.join('').includes('initial:80x24');
        },
        'resize probe initial dimensions',
        15_000,
      );
      controllers.terminal.resize(resizeSession.id, 132, 43);
      const resizeExitCode = await Promise.race([
        resizeRun,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('SIGWINCH resize probe timed out')), 15_000);
        }),
      ]);
      detachResize();
      if (resizeExitCode !== 0) {
        throw new Error(
          `resize probe failed (${resizeExitCode}); terminal:\n${resizeChunks.join('')}`,
        );
      }

      await controllers.files.createFile(stdinProbePath, stdinProbeSource);
      const stdinSession = controllers.terminal.createSession('stdin probe');
      const stdinChunks: string[] = [];
      const detachStdin = controllers.terminal.attach(stdinSession.id, (chunk) => {
        stdinChunks.push(chunk);
      });
      let stdinExit: number | null = null;
      const stdinRun = controllers.terminal.run(
        stdinSession.id,
        `cd ${root} && node src/controller-stdin-probe.mjs`,
      );
      void stdinRun.then((code) => {
        stdinExit = code;
      });
      await waitUntil(
        () => {
          if (stdinExit !== null) {
            throw new Error(
              `stdin probe exited before write (${stdinExit}); terminal:\n${stdinChunks.join('')}`,
            );
          }
          return stdinChunks.join('').includes('stdin:ready');
        },
        'stdin probe readiness',
        15_000,
      );
      controllers.terminal.write(stdinSession.id, 'controller-write-roundtrip\\n');
      const stdinExitCode = await Promise.race([
        stdinRun,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('stdin write probe timed out')), 15_000);
        }),
      ]);
      detachStdin();
      if (stdinExitCode !== 0) {
        throw new Error(
          `stdin probe failed (${stdinExitCode}); terminal:\n${stdinChunks.join('')}`,
        );
      }
      await controllers.files.deletePath(stdinProbePath);

      await controllers.files.deletePath(renamedPath);
      const afterDelete = controllers.files.snapshot();
      stopWatchingFiles();

      const createdWatchIndex = watchedSnapshots.findIndex((snapshot) =>
        snapshot.paths.includes(createdPath),
      );
      const renamedWatchIndex = watchedSnapshots.findIndex(
        (snapshot, index) =>
          index > createdWatchIndex &&
          snapshot.paths.includes(renamedPath) &&
          !snapshot.paths.includes(createdPath),
      );
      const deletedWatchIndex = watchedSnapshots.findIndex(
        (snapshot, index) =>
          index > renamedWatchIndex &&
          !snapshot.paths.includes(createdPath) &&
          !snapshot.paths.includes(renamedPath),
      );

      const decodeEntry = (entry: typeof createdEntry): string | null =>
        entry?.content === undefined ? null : new TextDecoder().decode(entry.content);
      const fileCrud = {
        watchEvents: watchedSnapshots.length,
        sawPendingMutation: watchedSnapshots.some((snapshot) => snapshot.pendingMutations > 0),
        sawDurableMutation: watchedSnapshots.some((snapshot) => snapshot.durable),
        watchReflected: {
          created: createdWatchIndex >= 0,
          renamed: renamedWatchIndex > createdWatchIndex,
          deleted: deletedWatchIndex > renamedWatchIndex,
        },
        created: {
          reflected: createdEntry !== undefined,
          content: decodeEntry(createdEntry),
          durable: afterCreate.durable,
        },
        renamed: {
          reflected:
            renamedEntry !== undefined &&
            !afterRename.entries.some((entry) => entry.path === createdPath),
          content: decodeEntry(renamedEntry),
          durable: afterRename.durable,
        },
        deleted: {
          reflected: !afterDelete.entries.some((entry) => entry.path === renamedPath),
          durable: afterDelete.durable,
        },
      };

      const terminalSessionId = controllers.terminal.snapshot().activeSessionId;
      const terminalChunks: string[] = [];
      const detachTerminal = controllers.terminal.attach(terminalSessionId, (chunk) => {
        terminalChunks.push(chunk);
      });
      const projectRun = controllers.terminal.runProject(terminalSessionId, {
        cols: 120,
        rows: 30,
      });
      const earlyExit = projectRun.then((exitCode) => {
        throw new Error(
          `project exited before preview LIVE (${exitCode}); terminal:\n${terminalChunks.join('')}`,
        );
      });
      await Promise.race([
        waitUntil(
          () => {
            const snapshot = controllers.preview.snapshot();
            if (snapshot.status === 'error') {
              throw new Error(`preview failed: ${snapshot.error ?? 'unknown error'}`);
            }
            return snapshot.status === 'live';
          },
          'preview LIVE',
          120_000,
        ),
        earlyExit,
      ]);

      await waitUntil(
        () => controllers.files.snapshot().nodeModulesPresent,
        'installed node_modules snapshot',
        15_000,
      );

      const preview = controllers.preview.snapshot();
      if (!preview.url) throw new Error('preview became LIVE without a URL');
      const iframe = document.createElement('iframe');
      iframe.id = 'public-workbench-preview';
      iframe.src = preview.url;
      document.body.append(iframe);

      const browserState = globalThis as typeof globalThis & {
        __buPublicWorkbench?: {
          readonly session: typeof session;
          readonly controllers: typeof controllers;
          readonly projectRun: Promise<number>;
          readonly terminalSessionId: string;
          readonly terminalChunks: string[];
          readonly detachTerminal: () => void;
          readonly iframe: HTMLIFrameElement;
        };
      };
      browserState.__buPublicWorkbench = {
        session,
        controllers,
        projectRun,
        terminalSessionId,
        terminalChunks,
        detachTerminal,
        iframe,
      };

      return {
        session: session.snapshot(),
        preview,
        filesReady: controllers.files.snapshot().ready,
        entryListed: controllers.files
          .list(`${entryPath.slice(0, entryPath.indexOf('/src/'))}/src`)
          .some((entry) => entry.name === 'main.js'),
        serviceWorkerControlled: navigator.serviceWorker.controller !== null,
        nodeModulesPresent: controllers.files.snapshot().nodeModulesPresent,
        terminal: terminalChunks.join(''),
        resizeProbe: { exitCode: resizeExitCode, terminal: resizeChunks.join('') },
        stdinProbe: { exitCode: stdinExitCode, terminal: stdinChunks.join('') },
        fileCrud,
      };
    },
    { entryPath: ENTRY_PATH, initialMarker: INITIAL_MARKER },
  );

  expect(boot.session.status).toBe('ready');
  expect(boot.session.storage.backend).toBe('opfs');
  expect(boot.preview).toMatchObject({ status: 'live', port: 5174, error: null });
  expect(boot.serviceWorkerControlled).toBe(true);
  expect(boot.filesReady).toBe(true);
  expect(boot.entryListed).toBe(true);
  expect(boot.nodeModulesPresent).toBe(true);
  expect(boot.terminal).toContain('npm: installing all from package.json');
  expect(boot.terminal).toMatch(/npm: \+ vite@/u);
  expect(boot.terminal).toMatch(/npm: installed \d+ package\(s\) in/u);
  expect(boot.resizeProbe).toEqual({
    exitCode: 0,
    terminal: expect.stringContaining('resize:132x43'),
  });
  expect(boot.stdinProbe).toEqual({
    exitCode: 0,
    terminal: expect.stringContaining('stdin:controller-write-roundtrip'),
  });
  expect(boot.fileCrud).toMatchObject({
    sawPendingMutation: true,
    sawDurableMutation: true,
    watchReflected: { created: true, renamed: true, deleted: true },
    created: { reflected: true, durable: true, content: expect.stringContaining('SIGWINCH') },
    renamed: { reflected: true, durable: true, content: expect.stringContaining('SIGWINCH') },
    deleted: { reflected: true, durable: true },
  });
  expect(boot.fileCrud.watchEvents).toBeGreaterThanOrEqual(10);

  const preview = page.frameLocator('#public-workbench-preview');
  await expect(preview.locator('#app')).toHaveText(INITIAL_MARKER, { timeout: 20_000 });

  const save = await page.evaluate(
    async ({ entryPath, updatedMarker }) => {
      const browserState = globalThis as typeof globalThis & {
        __buPublicWorkbench?: {
          readonly controllers: {
            readonly editor: {
              open(path: string): Promise<void>;
              edit(text: string): void;
              save(): Promise<void>;
              snapshot(): {
                readonly status: string;
                readonly text: string;
                readonly dirty: boolean;
                readonly durable: boolean;
              };
            };
            readonly files: {
              snapshot(): {
                readonly revision: number;
                readonly entries: readonly {
                  readonly path: string;
                  readonly content?: Uint8Array;
                }[];
              };
            };
          };
        };
      };
      const active = browserState.__buPublicWorkbench;
      if (!active) throw new Error('public workbench was not booted');
      const { editor, files } = active.controllers;
      await editor.open(entryPath);
      if (!editor.snapshot().text.includes('workbench-public-v1')) {
        throw new Error('editor did not read the configured starter overlay');
      }

      const source = `const marker = ${JSON.stringify(updatedMarker)};
const app = document.getElementById('app');
if (!app) throw new Error('Missing #app root');
app.textContent = marker;
if (import.meta.hot) import.meta.hot.accept();
`;
      const beforeRevision = files.snapshot().revision;
      editor.edit(source);
      const dirtyBeforeSave = editor.snapshot().dirty;
      await editor.save();

      const deadline = performance.now() + 15_000;
      let reflected = false;
      while (!reflected) {
        const snapshot = files.snapshot();
        const entry = snapshot.entries.find((candidate) => candidate.path === entryPath);
        reflected =
          snapshot.revision > beforeRevision &&
          entry?.content !== undefined &&
          new TextDecoder().decode(entry.content) === source;
        if (performance.now() >= deadline) {
          throw new Error(`saved file was not reflected by snapshot revision ${snapshot.revision}`);
        }
        if (!reflected) await new Promise((resolve) => setTimeout(resolve, 50));
      }

      return { dirtyBeforeSave, editor: editor.snapshot(), reflected };
    },
    { entryPath: ENTRY_PATH, updatedMarker: UPDATED_MARKER },
  );

  expect(save.dirtyBeforeSave).toBe(true);
  expect(save.editor).toMatchObject({ status: 'ready', dirty: false, durable: true });
  expect(save.reflected).toBe(true);
  await expect(preview.locator('#app')).toHaveText(UPDATED_MARKER, { timeout: 30_000 });

  const disposed = await page.evaluate(async () => {
    const browserState = globalThis as typeof globalThis & {
      __buPublicWorkbench?: {
        readonly session: {
          snapshot(): { readonly status: string };
          dispose(): Promise<void>;
        };
        readonly controllers: {
          readonly terminal: {
            stop(id: string): void;
            snapshot(): unknown;
          };
        };
        readonly projectRun: Promise<number>;
        readonly terminalSessionId: string;
        readonly terminalChunks: string[];
        readonly detachTerminal: () => void;
        readonly iframe: HTMLIFrameElement;
      };
    };
    const active = browserState.__buPublicWorkbench;
    if (!active) throw new Error('public workbench was not booted');
    active.controllers.terminal.stop(active.terminalSessionId);
    const exitCode = await active.projectRun;
    active.detachTerminal();
    active.iframe.remove();
    await active.session.dispose();
    let controllerRejected = false;
    try {
      active.controllers.terminal.snapshot();
    } catch {
      controllerRejected = true;
    }
    browserState.__buPublicWorkbench = undefined;
    return {
      exitCode,
      status: active.session.snapshot().status,
      controllerRejected,
      terminal: active.terminalChunks.join(''),
    };
  });

  expect(disposed.exitCode).toBe(130);
  expect(disposed.status).toBe('disposed');
  expect(disposed.controllerRejected).toBe(true);
  expect(disposed.terminal).toContain('VITE');
  expect(disposed.terminal).toContain('hmr update');
  expect(disposed.terminal).toContain('/src/main.js');
});
