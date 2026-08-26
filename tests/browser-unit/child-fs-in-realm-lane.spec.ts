import { expect, test } from '@playwright/test';
import { childFsScenario } from '../../tools/perf/child-fs/scenario.mjs';
import { validateChildFsRawSample } from '../../tools/perf/src/child-fs-artifact.mjs';
import { gotoHarness } from './fixtures.ts';

const workspacePath = process.cwd().replaceAll('\\', '/');
const laneFixtureUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/child-fs-in-realm-lane.ts`;

test('canonical anchors run through one recorded real in-realm Worker', async ({ page }) => {
  test.setTimeout(600_000);
  const ordinal = 5;
  await gotoHarness(page);
  const observed = await page.evaluate(
    async ({ laneUrl, ordinal }) => {
      const lane = await import(/* @vite-ignore */ laneUrl);
      const trace: Array<Record<string, unknown>> = [];
      const messages: unknown[] = [];
      const host = {
        open(url: string) {
          trace.push({ kind: 'open', url });
          const worker = new Worker(url, { type: 'module' });
          worker.addEventListener('message', (event) => {
            messages.push(event.data);
            trace.push({ kind: 'worker-message', message: event.data });
          });
          return {
            addEventListener(
              type: 'message' | 'messageerror' | 'error',
              listener: EventListenerOrEventListenerObject,
            ) {
              worker.addEventListener(type, listener);
            },
            removeEventListener(
              type: 'message' | 'messageerror' | 'error',
              listener: EventListenerOrEventListenerObject,
            ) {
              worker.removeEventListener(type, listener);
            },
            postMessage(message: unknown) {
              trace.push({ kind: 'post', message });
              worker.postMessage(message);
            },
            terminate() {
              trace.push({ kind: 'terminate' });
              worker.terminate();
            },
          };
        },
      };
      const result = await lane.runChildFsInRealmLane(ordinal, host);
      return { messages, result, trace };
    },
    { laneUrl: laneFixtureUrl, ordinal },
  );

  const opens = observed.trace.filter(({ kind }) => kind === 'open');
  expect(opens).toHaveLength(1);
  expect(String(opens[0]?.url)).toContain('child-fs-in-realm-worker.ts');
  expect(observed.trace.filter(({ kind }) => kind === 'terminate')).toHaveLength(1);
  expect(observed.trace.at(-1)).toEqual({ kind: 'terminate' });

  const posts = observed.trace
    .filter(({ kind }) => kind === 'post')
    .map(({ message }) => message as Record<string, unknown>);
  const replies = observed.messages.map((message) => message as Record<string, unknown>);
  const replyKinds = replies.map(({ kind }) => kind);
  expect(replyKinds[0]).toBe('ready');
  expect(replyKinds.slice(0, 7)).toEqual([
    'ready',
    'booted',
    'seeded',
    'installed',
    'written',
    'vite',
    'entries',
  ]);
  expect(replyKinds.at(-1)).toBe('express');

  const scenario = childFsScenario();
  expect(posts[0]).toEqual({ kind: 'boot' });
  expect(posts[1]).toEqual({ kind: 'seed', files: scenario.files, root: scenario.root });
  expect(posts[2]).toEqual({
    kind: 'install',
    dependencies: scenario.dependencies,
    registryUrl: '/npm-registry',
    root: scenario.root,
  });
  const installed = replies.find(({ kind }) => kind === 'installed');
  expect(installed?.versions).toEqual(scenario.dependencies);

  const marker = `in-realm-${ordinal}`;
  const panelSeed = scenario.files['/src/Panel.jsx'];
  if (panelSeed === undefined) throw new TypeError('canonical Panel seed is missing');
  const markerSource = panelSeed
    .replace('bench-seed', marker)
    .replace('bench-seed', `run-${ordinal}`);
  expect(posts[3]).toEqual({
    kind: 'write',
    contents: markerSource,
    path: `${scenario.root}/src/Panel.jsx`,
  });
  expect(posts[4]).toEqual({ kind: 'vite', root: scenario.root });
  expect(posts[5]).toEqual({ kind: 'readdir', path: `${scenario.root}/dist/assets` });

  const entriesReply = replies.find(({ kind }) => kind === 'entries');
  const emittedPaths = (entriesReply?.paths as unknown[] | undefined)?.filter(
    (path): path is string =>
      typeof path === 'string' &&
      path.startsWith(`${scenario.root}/dist/assets/`) &&
      path.endsWith('.js'),
  );
  expect(emittedPaths).toBeDefined();
  expect(emittedPaths).not.toHaveLength(0);
  expect(posts.slice(6, -1)).toEqual(emittedPaths?.map((path) => ({ kind: 'read', path })));
  expect(posts.at(-1)).toEqual({
    kind: 'express',
    entryPath: `${scenario.root}/express-anchor.cjs`,
    marker,
    root: scenario.root,
  });

  const traceKinds = observed.trace.map(({ kind, message }) =>
    kind === 'post' || kind === 'worker-message'
      ? `${kind}:${String((message as Record<string, unknown>).kind)}`
      : String(kind),
  );
  expect(traceKinds.slice(0, 14)).toEqual([
    'open',
    'worker-message:ready',
    'post:boot',
    'worker-message:booted',
    'post:seed',
    'worker-message:seeded',
    'post:install',
    'worker-message:installed',
    'post:write',
    'worker-message:written',
    'post:vite',
    'worker-message:vite',
    'post:readdir',
    'worker-message:entries',
  ]);
  expect(traceKinds.at(-1)).toBe('terminate');

  const viteReply = replies.find(({ kind }) => kind === 'vite');
  const expressReply = replies.find(({ kind }) => kind === 'express');
  const emittedJavaScript = emittedPaths
    ?.map((path) => {
      const read = replies.find((reply) => reply.kind === 'read' && reply.path === path);
      if (typeof read?.text !== 'string') throw new TypeError(`missing emitted read ${path}`);
      return read.text;
    })
    .join('\n');
  expect(observed.result.sample).toEqual({
    lane: 'in-realm',
    topology: 'single-in-realm-worker',
    ordinal,
    ownerLoad: 'idle',
    vite: {
      exitCode: viteReply?.exitCode,
      rawOutput: viteReply?.rawOutput,
      emittedJavaScript,
      marker,
    },
    express: {
      exitCode: expressReply?.exitCode,
      rawOutput: expressReply?.rawOutput,
      marker,
    },
  });
  expect(validateChildFsRawSample(observed.result.sample).vite.transformedModules).toBe(2180);
});
