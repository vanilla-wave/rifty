import { type Page, expect, test } from '@playwright/test';
import type * as Companion from '../../apps/playground/src/browser-unit/workbench-playground-entry.ts';
import type * as HostAssets from '../../apps/playground/src/browser-unit/workbench-vite-host-assets.ts';
import {
  bootOwner,
  closeOwner,
  execLine,
  gotoHarness,
  sealedWorkbenchFixtureUrl,
  writeOwnerFile,
} from './fixtures.ts';

// Goal project-location-independence (ADR-0531): the guest sees the active project
// at the `publicProjectRoot` Workbench option (default `/home/project`), with
// project-owned `/tmp` and `/home/rifty`.
const SCENARIO_2 =
  "node -e \"const fs=require('fs'),os=require('os'),p=require('path');console.log(os.tmpdir(),os.homedir(),process.cwd());console.log(fs.mkdtempSync(p.join(os.tmpdir(),'x-')));fs.writeFileSync(p.join(os.homedir(),'.npmrc'),'x')\"";

const words = (out: string): string[] =>
  out
    .replaceAll('\r', '')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strip terminal colors.
    .replace(/\u001b\[[0-9;]*m/gu, '')
    .split(/\s+/u)
    .filter((word) => word.length > 0);

const lines = (out: string): string[] =>
  out
    .replaceAll('\r', '')
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strip terminal colors.
    .replace(/\u001b\[[0-9;]*m/gu, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);

async function projectRootNames(page: Page): Promise<string[]> {
  return page.evaluate(async (fixtureUrl) => {
    const fixture = await import(/* @vite-ignore */ fixtureUrl);
    const entries = await fixture.currentProject().files.readdir('/');
    return entries.map((entry: { readonly path: string }) => entry.path);
  }, sealedWorkbenchFixtureUrl);
}

/** Dev server ready → `#app` text, then an edit of `src/main.js` updates it in place over HMR. */
async function devHmr(
  page: Page,
  edited: string,
): Promise<{ before: string; after: string; sameWindow: boolean }> {
  return page.evaluate(
    async ({ fixtureUrl, source }) => {
      const fixture = await import(/* @vite-ignore */ fixtureUrl);
      const run = fixture.currentProject().run();
      const frame = document.createElement('iframe');
      try {
        const ready = await run.ready;
        frame.src = new URL(ready.url, location.href).href;
        const loaded = new Promise<void>((resolve) =>
          frame.addEventListener('load', () => resolve(), { once: true }),
        );
        document.body.appendChild(frame);
        await loaded;
        const text = (): string => frame.contentDocument?.getElementById('app')?.textContent ?? '';
        const until = async (predicate: () => boolean, label: string): Promise<void> => {
          const deadline = Date.now() + 60_000;
          while (!predicate()) {
            if (Date.now() > deadline)
              throw new Error(`${label} timed out; #app=${JSON.stringify(text())}`);
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        };
        await until(() => text().length > 0, 'initial render');
        const before = text();
        const sentinel = frame.contentWindow as (Window & { __locationSentinel?: number }) | null;
        if (sentinel === null) throw new Error('preview frame has no window');
        sentinel.__locationSentinel = 1;
        await fixture.writeProjectText('/scratch/src/main.js', source);
        await until(() => text().includes('LOCATION-HMR'), 'HMR update');
        return {
          before,
          after: text(),
          sameWindow:
            (frame.contentWindow as Window & { __locationSentinel?: number }).__locationSentinel ===
            1,
        };
      } finally {
        frame.remove();
        await run.stop().catch(() => {});
        await run.close().catch(() => {});
      }
    },
    { fixtureUrl: sealedWorkbenchFixtureUrl, source: edited },
  );
}

/** Dev server ready → `#app` text; an edit of `src/main.js` is served after a reload. */
async function devReload(page: Page, edited: string): Promise<{ before: string; after: string }> {
  return page.evaluate(
    async ({ fixtureUrl, source }) => {
      const fixture = await import(/* @vite-ignore */ fixtureUrl);
      const run = fixture.currentProject().run();
      const frame = document.createElement('iframe');
      try {
        const ready = await run.ready;
        const load = (): Promise<void> =>
          new Promise<void>((resolve) => {
            frame.addEventListener('load', () => resolve(), { once: true });
          });
        const text = (): string => frame.contentDocument?.getElementById('app')?.textContent ?? '';
        const rendered = async (label: string): Promise<void> => {
          const deadline = Date.now() + 60_000;
          while (text().length === 0) {
            if (Date.now() > deadline) throw new Error(`${label} timed out`);
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
        };
        let loaded = load();
        frame.src = new URL(ready.url, location.href).href;
        document.body.appendChild(frame);
        await loaded;
        await rendered('initial render');
        const before = text();
        await fixture.writeProjectText('/scratch/src/main.js', source);
        // The dev server serves the edit once its watcher saw it; reload until then.
        const deadline = Date.now() + 60_000;
        for (;;) {
          loaded = load();
          frame.contentWindow?.location.reload();
          await loaded;
          await rendered('reloaded render');
          if (text() !== before || Date.now() > deadline) break;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return { before, after: text() };
      } finally {
        frame.remove();
        await run.stop().catch(() => {});
        await run.close().catch(() => {});
      }
    },
    { fixtureUrl: sealedWorkbenchFixtureUrl, source: edited },
  );
}

async function snapshotPaths(page: Page): Promise<string[]> {
  return page.evaluate(async (fixtureUrl) => {
    const fixture = await import(/* @vite-ignore */ fixtureUrl);
    return fixture
      .currentProject()
      .files.snapshot()
      .entries.map((entry: { readonly path: string }) => entry.path);
  }, sealedWorkbenchFixtureUrl);
}

async function archivePaths(page: Page): Promise<string[]> {
  return page.evaluate(async (fixtureUrl) => {
    const fixture = await import(/* @vite-ignore */ fixtureUrl);
    const archive = JSON.parse(await fixture.currentSessionTools().archive.export()) as {
      readonly files: readonly { readonly path: string }[];
    };
    return archive.files.map((file) => file.path);
  }, sealedWorkbenchFixtureUrl);
}

/** `vite preview` on 4174 → the routed preview serves the built index.html. */
async function previewHtml(page: Page): Promise<string> {
  return page.evaluate(async (fixtureUrl) => {
    const fixture = await import(/* @vite-ignore */ fixtureUrl);
    const terminal = fixture.currentProject().terminals.open();
    let out = '';
    const detach = terminal.attach((chunk: string) => {
      out += chunk;
    });
    const run = terminal.run('vite preview --host 127.0.0.1 --port 4174');
    try {
      const deadline = Date.now() + 60_000;
      let preview: { readonly url: string } | undefined;
      while (preview === undefined) {
        preview = fixture
          .currentSessionTools()
          .previews.snapshot()
          .find((entry: { readonly port: number }) => entry.port === 4174);
        if (preview !== undefined) break;
        if (Date.now() > deadline) throw new Error(`vite preview never routed\n${out}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return await (await fetch(new URL(preview.url, location.href))).text();
    } finally {
      detach();
      await run.stop().catch(() => {});
      await run.close().catch(() => {});
      await terminal.close().catch(() => {});
    }
  }, sealedWorkbenchFixtureUrl);
}

const EDITED_MAIN = `export function render() {
  document.getElementById('app').textContent = 'LOCATION-HMR';
}
render();
if (import.meta.hot) {
  import.meta.hot.accept((next) => {
    next?.render();
  });
}
`;

for (const location of [
  {
    label: 'default',
    publicProjectRoot: undefined,
    root: '/home/project',
    rootListing: ['home', 'tmp'],
  },
  {
    label: 'second',
    publicProjectRoot: '/srv/app',
    root: '/srv/app',
    rootListing: ['home', 'srv', 'tmp'],
  },
] as const) {
  test(`${location.label} location: guest namespace and the Vite 7 starter at ${location.root}`, async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await gotoHarness(page);
    await bootOwner(page, {
      workspaceId: `bu-location-${location.label}`,
      template: 'vite',
      setup: 'instant',
      persistence: 'ephemeral',
      ...(location.publicProjectRoot === undefined
        ? {}
        : { publicProjectRoot: location.publicProjectRoot }),
    });
    try {
      expect(lines((await execLine(page, 'pwd')).out)).toContain(location.root);
      expect(lines((await execLine(page, 'node -e "console.log(process.cwd())"')).out)).toContain(
        location.root,
      );
      expect(words((await execLine(page, 'ls /')).out)).toEqual(location.rootListing);
      expect(words((await execLine(page, 'ls /home')).out)).toEqual(
        location.root === '/home/project' ? ['project', 'rifty'] : ['rifty'],
      );

      const scenario = await execLine(page, SCENARIO_2);
      expect(scenario.exit, scenario.out).toBe(0);
      const printed = lines(scenario.out);
      expect(printed).toContain(`/tmp /home/rifty ${location.root}`);
      expect(
        printed.some((line) => /^\/tmp\/x-[A-Za-z0-9]{6}$/u.test(line)),
        scenario.out,
      ).toBe(true);
      expect(lines((await execLine(page, 'echo $HOME')).out)).toContain('/home/rifty');
      expect(lines((await execLine(page, 'cat ~/.npmrc')).out)).toContain('x');
      expect(lines((await execLine(page, 'cd; pwd')).out)).toContain('/home/rifty');
      await execLine(page, `cd ${location.root}`);
      expect(await projectRootNames(page)).not.toEqual(expect.arrayContaining(['/tmp']));
      expect(await projectRootNames(page)).not.toEqual(expect.arrayContaining(['/home']));
      expect(await projectRootNames(page)).not.toEqual(expect.arrayContaining(['/.npmrc']));
      expect(
        (await snapshotPaths(page)).filter((path) => /^\/(tmp|home|\.npmrc)(\/|$)/u.test(path)),
      ).toEqual([]);
      expect(
        (await archivePaths(page)).filter((path) => /(^|\/)(tmp|home|\.npmrc)(\/|$)/u.test(path)),
      ).toEqual([]);

      const build = await execLine(page, 'vite build');
      expect(build.exit, build.out).toBe(0);
      expect(build.out).toMatch(/✓ built in/u);
      expect(
        words((await execLine(page, 'ls dist/assets')).out).some((name) => name.endsWith('.js')),
      ).toBe(true);
      const html = await previewHtml(page);
      expect(html).toMatch(
        /<script type="module" crossorigin src="[^"]*assets\/[^"]+\.js"><\/script>/u,
      );

      const hmr = await devHmr(page, EDITED_MAIN);
      expect(hmr.before).toContain('Hello from real Vite');
      expect(hmr.after).toBe('LOCATION-HMR');
      expect(hmr.sameWindow).toBe(true);
    } finally {
      await closeOwner(page);
    }
  });

  test(`${location.label} location: Vite 8 starter build and preview at ${location.root}`, async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await gotoHarness(page);
    await bootOwner(page, {
      workspaceId: `bu-location-vite8-${location.label}`,
      template: 'vite8',
      setup: 'instant',
      persistence: 'ephemeral',
      ...(location.publicProjectRoot === undefined
        ? {}
        : { publicProjectRoot: location.publicProjectRoot }),
    });
    try {
      expect(lines((await execLine(page, 'pwd')).out)).toContain(location.root);
      const build = await execLine(page, 'vite build');
      expect(build.exit, build.out).toBe(0);
      expect(build.out).toMatch(/✓ built in/u);
      const html = await previewHtml(page);
      expect(html).toMatch(/assets\/[^"]+\.js/u);
      const dev = await devReload(page, EDITED_MAIN);
      expect(dev.before).toContain('Hello from real Vite 8');
      expect(dev.after).toBe('LOCATION-HMR');
    } finally {
      await closeOwner(page);
    }
  });
}

test('namespace edges, diagnostics and Node env-driven os paths at the default', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-location-edges',
    template: 'hidden-empty',
    persistence: 'ephemeral',
  });
  try {
    expect((await execLine(page, 'npm install')).exit).toBe(0);
    const missing = await execLine(page, 'node missing.cjs');
    expect(missing.exit).not.toBe(0);
    expect(missing.out).toContain("Cannot find module '/home/project/missing.cjs'");
    // GNU coreutils wording for EACCES; a mount point refuses before rm runs (EPERM).
    const touch = await execLine(page, 'touch /x');
    expect(touch.exit).not.toBe(0);
    expect(touch.out).toContain("touch: cannot touch '/x': Permission denied");
    const mkdir = await execLine(page, 'mkdir /home/x');
    expect(mkdir.exit).not.toBe(0);
    expect(mkdir.out).toContain('Permission denied');
    const rm = await execLine(page, 'rm -rf /home/project');
    expect(rm.exit).not.toBe(0);
    expect(rm.out).toContain('EPERM');
    // Separate mounts: Node's rename sees EXDEV; GNU mv copies then removes.
    expect((await execLine(page, 'echo a > /tmp/a && echo b > /tmp/b')).exit).toBe(0);
    const rename = await execLine(
      page,
      `node -e "try { require('fs').renameSync('/tmp/b', '/home/project/b'); console.log('RENAMED') } catch (e) { console.log('RENAME=' + e.code) }"`,
    );
    expect(lines(rename.out)).toContain('RENAME=EXDEV');
    expect((await execLine(page, 'mv /tmp/a /home/project/a')).exit).toBe(0);
    expect(lines((await execLine(page, 'cat /home/project/a')).out)).toContain('a');
    expect((await execLine(page, 'cat /tmp/a')).exit).not.toBe(0);
    // Node v24.16.0: HOME and TMPDIR drive os.homedir()/os.tmpdir() (trailing slash stripped).
    expect(
      lines(
        (await execLine(page, 'HOME=/tmp node -e "console.log(require(\'os\').homedir())"')).out,
      ),
    ).toContain('/tmp');
    expect(
      lines(
        (
          await execLine(
            page,
            'TMPDIR=/home/rifty/t/ node -e "console.log(require(\'os\').tmpdir())"',
          )
        ).out,
      ),
    ).toContain('/home/rifty/t');
  } finally {
    await closeOwner(page);
  }
});

test('project root `/`: project files plus mounts; a project `tmp` collides loudly', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-location-root',
    template: 'vite',
    setup: 'instant',
    persistence: 'ephemeral',
    publicProjectRoot: '/',
  });
  try {
    expect(lines((await execLine(page, 'pwd')).out)).toContain('/');
    const listing = words((await execLine(page, 'ls /')).out);
    expect(listing).toEqual(expect.arrayContaining(['home', 'index.html', 'package.json', 'tmp']));
    const build = await execLine(page, 'vite build');
    expect(build.exit, build.out).toBe(0);
    expect(await previewHtml(page)).toMatch(/assets\/[^"]+\.js/u);
  } finally {
    await closeOwner(page);
  }
  await bootOwner(page, {
    workspaceId: 'bu-location-root-collision',
    template: 'hidden-empty',
    persistence: 'ephemeral',
    publicProjectRoot: '/',
  });
  try {
    await writeOwnerFile(page, '/scratch/tmp/own.txt', 'project tmp');
    for (const line of ['ls /tmp', 'ls /']) {
      const collided = await execLine(page, line);
      expect(collided.exit, line).not.toBe(0);
      expect(collided.out, line).toMatch(/EEXIST.*\/tmp/u);
    }
  } finally {
    await closeOwner(page);
  }
});

test('project-owned ~ and /tmp persist across reopen and are not shared between projects', async ({
  page,
}) => {
  test.setTimeout(300_000);
  await gotoHarness(page);
  const result = await page.evaluate(async () => {
    const sdkUrl = '/src/browser-unit/workbench-playground-entry.ts';
    const assetsUrl = '/src/browser-unit/workbench-vite-host-assets.ts';
    const sdk = (await import(/* @vite-ignore */ sdkUrl)) as typeof Companion;
    const { workbenchViteHostAssets: assets } = (await import(
      /* @vite-ignore */ assetsUrl
    )) as typeof HostAssets;
    const options = {
      deployment: { ...assets, serviceWorker: { url: '/sw.js', scope: '/' } },
      packageAcquisition: { registryUrl: '/npm-registry' },
      storage: {
        persistence: 'required' as const,
        namespace: `bu-location-${crypto.randomUUID()}`,
      },
    };
    const plan = (id: string): Companion.PlaygroundProjectPlan => ({
      kind: 'node-cli',
      id,
      starterId: 'location',
      templateId: 'location',
      entryPath: '/main.cjs',
      files: { '/package.json': '{"name":"location","private":true}\n', '/main.cjs': '' },
      firstMaterialization: { kind: 'install' },
    });
    const run = async (project: { terminals: { open(): unknown } }, line: string) => {
      const terminal = project.terminals.open() as {
        attach(listener: (chunk: string) => void): () => void;
        run(line: string): { exitCode: Promise<number>; close(): Promise<unknown> };
        close(): Promise<void>;
      };
      let out = '';
      const detach = terminal.attach((chunk) => {
        out += chunk;
      });
      try {
        const command = terminal.run(line);
        const exit = await command.exitCode;
        await command.close();
        return { exit, out };
      } finally {
        detach();
        await terminal.close();
      }
    };
    const owned = `node -e "const fs=require('fs');console.log('OWNED=' + JSON.stringify([fs.readdirSync('/home/rifty'), fs.readdirSync('/tmp')]))"`;
    const first = await sdk.openPlaygroundWorkbench(options);
    const scratchDefinition = first.playground.define(plan('scratch'));
    await first.playground.catalog.createScratch({ definition: scratchDefinition });
    let scratch = await first.openProject(scratchDefinition);
    const written = await run(
      scratch,
      'echo keep > $HOME/.npmrc && echo tmp > /tmp/keep.txt && cat ~/.npmrc /tmp/keep.txt',
    );
    await scratch.close();
    await first.close();

    const second = await sdk.openPlaygroundWorkbench(options);
    try {
      const definition = second.playground.define(plan('scratch'));
      await second.playground.catalog.createScratch({ definition, preserveDirtySameStarter: true });
      scratch = await second.openProject(definition);
      const reopened = await run(scratch, 'cat ~/.npmrc /tmp/keep.txt');
      await scratch.close();
      // Save converts the scratch into the project (ADR-0165): its ~ and /tmp come along.
      const savedDefinition = second.playground.define(plan('saved'));
      await second.playground.catalog.saveScratch({
        id: 'saved',
        name: 'Saved',
        definition: savedDefinition,
      });
      await second.playground.catalog.activate({ kind: 'project', id: 'saved' });
      let saved = await second.openProject(savedDefinition);
      const carried = await run(saved, 'cat ~/.npmrc /tmp/keep.txt && echo mine > ~/.npmrc');
      await saved.close();
      const freshDefinition = second.playground.define({
        ...plan('scratch'),
        starterId: 'location-fresh',
      });
      await second.playground.catalog.createScratch({ definition: freshDefinition });
      const fresh = await second.openProject(freshDefinition);
      const freshListing = await run(fresh, owned);
      await fresh.close();
      await second.playground.catalog.activate({ kind: 'project', id: 'saved' });
      saved = await second.openProject(savedDefinition);
      const back = await run(saved, 'cat ~/.npmrc');
      await saved.close();
      return { written, reopened, carried, freshListing, back };
    } finally {
      await second.close();
    }
  });
  expect(result.written.exit, result.written.out).toBe(0);
  expect(result.reopened.exit, result.reopened.out).toBe(0);
  expect(lines(result.reopened.out)).toEqual(expect.arrayContaining(['keep', 'tmp']));
  expect(result.carried.exit, result.carried.out).toBe(0);
  expect(lines(result.carried.out)).toEqual(expect.arrayContaining(['keep', 'tmp']));
  expect(result.freshListing.exit, result.freshListing.out).toBe(0);
  expect(lines(result.freshListing.out)).toContain('OWNED=[[],[]]');
  expect(lines(result.back.out)).toContain('mine');
});
