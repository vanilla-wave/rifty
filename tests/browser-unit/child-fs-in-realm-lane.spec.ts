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
  const pageWorkerUrls: string[] = [];
  page.on('worker', (worker) => pageWorkerUrls.push(worker.url()));
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
  const openedWorkerUrl = new URL(String(opens[0]?.url), page.url());
  expect(openedWorkerUrl.pathname).toBe(
    `/@fs${workspacePath}/tests/browser-unit/fixtures/child-fs-in-realm-worker.ts`,
  );
  expect(pageWorkerUrls).toEqual([openedWorkerUrl.href]);
  expect(observed.trace.filter(({ kind }) => kind === 'terminate')).toHaveLength(1);
  expect(observed.trace.at(-1)).toEqual({ kind: 'terminate' });

  const posts = observed.trace
    .filter(({ kind }) => kind === 'post')
    .map(({ message }) => message as Record<string, unknown>);
  const replies = observed.messages.map((message) => message as Record<string, unknown>);
  const replyKinds = replies.map(({ kind }) => kind);
  expect(replyKinds[0]).toBe('ready');
  expect(replies[0]).toEqual({ kind: 'ready' });
  expect(replyKinds.slice(-2)).toEqual(['express', 'finished']);

  const scenario = childFsScenario();
  expect(posts[0]).toEqual({ kind: 'boot' });
  expect(posts[1]).toEqual({ kind: 'seed', files: scenario.files, root: scenario.root });
  expect(posts[2]).toEqual({
    kind: 'install',
    dependencies: scenario.dependencies,
    registryUrl: '/npm-registry',
    root: scenario.root,
  });
  const manifestPaths = Object.keys(scenario.dependencies).map(
    (dependency) => `${scenario.root}/node_modules/${dependency}/package.json`,
  );
  expect(posts.slice(3, 3 + manifestPaths.length)).toEqual(
    manifestPaths.map((path) => ({ kind: 'read', path })),
  );
  for (const [dependency, version] of Object.entries(scenario.dependencies)) {
    const path = `${scenario.root}/node_modules/${dependency}/package.json`;
    const read = replies.find((reply) => reply.kind === 'read' && reply.path === path);
    if (typeof read?.text !== 'string') throw new TypeError(`missing manifest read ${path}`);
    expect(JSON.parse(read.text)).toMatchObject({ version });
  }

  const marker = `in-realm-${ordinal}`;
  const panelSeed = scenario.files['/src/Panel.jsx'];
  if (panelSeed === undefined) throw new TypeError('canonical Panel seed is missing');
  const markerSource = panelSeed
    .replace('bench-seed', marker)
    .replace('bench-seed', `run-${ordinal}`);
  const writeIndex = 3 + manifestPaths.length;
  expect(posts[writeIndex]).toEqual({
    kind: 'write',
    contents: markerSource,
    path: `${scenario.root}/src/Panel.jsx`,
  });
  expect(posts[writeIndex + 1]).toEqual({
    kind: 'vite',
    args: ['build'],
    entryPath: `${scenario.root}/node_modules/.bin/vite`,
    root: scenario.root,
  });
  expect(posts[writeIndex + 2]).toEqual({
    kind: 'readdir',
    path: `${scenario.root}/dist/assets`,
  });

  const entriesReply = replies.find(({ kind }) => kind === 'entries');
  expect(Object.keys(entriesReply ?? {}).toSorted()).toEqual(['kind', 'paths']);
  const emittedPaths = (entriesReply?.paths as unknown[] | undefined)?.filter(
    (path): path is string =>
      typeof path === 'string' &&
      path.startsWith(`${scenario.root}/dist/assets/`) &&
      path.endsWith('.js'),
  );
  expect(emittedPaths).toBeDefined();
  expect(emittedPaths).not.toHaveLength(0);
  expect(posts.slice(writeIndex + 3, -2)).toEqual(
    emittedPaths?.map((path) => ({ kind: 'read', path })),
  );
  expect(posts.at(-2)).toEqual({
    kind: 'express',
    entryPath: `${scenario.root}/express-anchor.cjs`,
    marker,
    root: scenario.root,
  });
  expect(posts.at(-1)).toEqual({ kind: 'finish' });

  const traceKinds = observed.trace.map(({ kind, message }) =>
    kind === 'post' || kind === 'worker-message'
      ? `${kind}:${String((message as Record<string, unknown>).kind)}`
      : String(kind),
  );
  const replyKind = (postKind: unknown): string => {
    if (postKind === 'boot') return 'booted';
    if (postKind === 'seed') return 'seeded';
    if (postKind === 'install') return 'installed';
    if (postKind === 'write') return 'written';
    if (postKind === 'readdir') return 'entries';
    if (postKind === 'finish') return 'finished';
    return String(postKind);
  };
  expect(traceKinds).toEqual([
    'open',
    'worker-message:ready',
    ...posts.flatMap((post) => [
      `post:${String(post.kind)}`,
      `worker-message:${replyKind(post.kind)}`,
    ]),
    'terminate',
  ]);

  const phaseReplies = replies.slice(1);
  expect(phaseReplies).toHaveLength(posts.length);
  for (const [index, post] of posts.entries()) {
    const reply = phaseReplies[index];
    expect(reply?.kind).toBe(replyKind(post.kind));
    if (post.kind === 'read') expect(reply?.path).toBe(post.path);
  }
  expect(replies.find(({ kind }) => kind === 'booted')).toEqual({
    kind: 'booted',
    backend: 'memory',
  });
  expect(replies.find(({ kind }) => kind === 'seeded')).toEqual({
    kind: 'seeded',
    paths: Object.keys(scenario.files)
      .map((path) => `${scenario.root}${path}`)
      .toSorted(),
  });
  expect(replies.find(({ kind }) => kind === 'installed')).toEqual({ kind: 'installed' });
  expect(replies.find(({ kind }) => kind === 'written')).toEqual({
    kind: 'written',
    path: `${scenario.root}/src/Panel.jsx`,
  });
  expect(replies.find(({ kind }) => kind === 'finished')).toEqual({ kind: 'finished' });

  const viteReply = replies.find(({ kind }) => kind === 'vite');
  const expressReply = replies.find(({ kind }) => kind === 'express');
  expect(Object.keys(viteReply ?? {}).toSorted()).toEqual(['exitCode', 'kind', 'rawOutput']);
  expect(Object.keys(expressReply ?? {}).toSorted()).toEqual(['exitCode', 'kind', 'rawOutput']);
  for (const reply of phaseReplies.filter(({ kind }) => kind === 'read')) {
    expect(Object.keys(reply).toSorted()).toEqual(['kind', 'path', 'text']);
  }
  const emittedJavaScript = emittedPaths
    ?.map((path) => {
      const read = phaseReplies.find((reply) => reply?.kind === 'read' && reply.path === path);
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
