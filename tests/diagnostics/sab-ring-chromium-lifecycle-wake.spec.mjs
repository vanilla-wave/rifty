import { expect, test } from '@playwright/test';
import { expectTerminalContains, pickStarter } from '../e2e/helpers/playground.ts';

const BREAKPOINT_SCRIPT_PATTERNS = [
  /quickjs-kernel-worker-host-[A-Za-z0-9_-]+\.js$/u,
  /node-entry-bootstrap-[A-Za-z0-9_-]+\.js$/u,
  /dev-server-child-bootstrap-[A-Za-z0-9_-]+\.js$/u,
];
const CONSUME_REPLY_GUARD = 'SabRing: cannot consume reply unless reply is ready';
const CYCLES = 8;
const PHASE_MS = 30_000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Tunnel CDP commands through recursively auto-attached, non-flattened targets. */
function createNestedCdp(root, onAttached, onEvent) {
  let commandId = 0;
  let wrapperId = -1;
  const pending = new Map();
  const key = (path, id) => `${path.join('/')}:${String(id)}`;

  function receive(path, message) {
    if (message.method === 'Target.receivedMessageFromTarget') {
      receive([...path, message.params.sessionId], JSON.parse(message.params.message));
      return;
    }
    if (typeof message.id === 'number') {
      const request = pending.get(key(path, message.id));
      if (request !== undefined) {
        pending.delete(key(path, message.id));
        if (message.error === undefined) request.resolve(message.result ?? {});
        else request.reject(new Error(message.error.message));
      }
      return;
    }
    onEvent(path, message.method, message.params);
  }

  root.on('Target.receivedMessageFromTarget', (event) => {
    receive([event.sessionId], JSON.parse(event.message));
  });
  root.on('Target.attachedToTarget', (event) => {
    onAttached([event.sessionId], event.targetInfo, event.waitingForDebugger);
  });

  async function send(path, method, params = {}) {
    const id = ++commandId;
    const response = new Promise((resolve, reject) => {
      pending.set(key(path, id), { resolve, reject });
    });
    let message = JSON.stringify({ id, method, params });
    for (let index = path.length - 1; index >= 1; index -= 1) {
      message = JSON.stringify({
        id: wrapperId--,
        method: 'Target.sendMessageToTarget',
        params: { sessionId: path[index], message },
      });
    }
    await root.send('Target.sendMessageToTarget', { sessionId: path[0], message });
    return Promise.race([
      response,
      delay(10_000).then(() => {
        throw new Error(`CDP ${method} timed out for ${path.join('/')}`);
      }),
    ]);
  }

  return { send };
}

function remoteValue(response) {
  if (response.exceptionDetails !== undefined) {
    return { exception: response.exceptionDetails.text };
  }
  return response.result?.value ?? response.result?.description ?? null;
}

function sourceLocation(source, offset) {
  const prefix = source.slice(0, offset);
  const lineNumber = prefix.match(/\n/gu)?.length ?? 0;
  const lastNewline = prefix.lastIndexOf('\n');
  return { lineNumber, columnNumber: offset - lastNewline - 1 };
}

test('captures the Chromium lifecycle wake at the existing consumeReply guard', async ({
  browserName,
  context,
  page,
}) => {
  test.skip(browserName !== 'chromium', 'SharedArrayBuffer carrier is Chromium-only');
  const startedAt = Date.now();
  const targetByPath = new Map();
  const scriptUrlByPathAndId = new Map();
  const initializing = new Set();
  const armedScripts = new Set();
  let phase = { state: 'boot', cycle: 0, enteredAt: startedAt };
  let capture;
  let capturing = false;
  let resolveCapture;
  const captureReady = new Promise((resolve) => {
    resolveCapture = resolve;
  });
  let rejectHarness;
  const harnessFailure = new Promise((_, reject) => {
    rejectHarness = reject;
  });
  const root = await context.newCDPSession(page);

  const failHarness = (error) => {
    rejectHarness(error instanceof Error ? error : new Error(String(error)));
  };

  const nested = createNestedCdp(
    root,
    (path, targetInfo, waitingForDebugger) => {
      void initializeTarget(path, targetInfo, waitingForDebugger).catch(failHarness);
    },
    (path, method, params) => {
      if (method === 'Target.attachedToTarget') {
        void initializeTarget(
          [...path, params.sessionId],
          params.targetInfo,
          params.waitingForDebugger,
        ).catch(failHarness);
        return;
      }
      if (method === 'Debugger.scriptParsed') {
        scriptUrlByPathAndId.set(`${path.join('/')}:${params.scriptId}`, params.url);
        void armConsumeReplyBreakpoint(path, params).catch(failHarness);
        return;
      }
      if (method === 'Debugger.paused') {
        void captureGuard(path, params).catch(failHarness);
      }
    },
  );

  async function evaluate(path, callFrameId, expression) {
    return remoteValue(
      await nested.send(path, 'Debugger.evaluateOnCallFrame', {
        callFrameId,
        expression,
        returnByValue: true,
        silent: true,
      }),
    );
  }

  async function localProperties(path, frame) {
    const local = frame.scopeChain.find((scope) => scope.type === 'local');
    if (local?.object.objectId === undefined) return [];
    const properties = await nested.send(path, 'Runtime.getProperties', {
      objectId: local.object.objectId,
      ownProperties: true,
      generatePreview: false,
    });
    return (properties.result ?? []).map((property) => ({
      name: property.name,
      value: property.value?.value ?? property.value?.description ?? null,
    }));
  }

  async function armConsumeReplyBreakpoint(path, params) {
    if (!BREAKPOINT_SCRIPT_PATTERNS.some((pattern) => pattern.test(params.url))) return;
    const key = `${path.join('/')}:${params.scriptId}`;
    if (armedScripts.has(key)) return;
    armedScripts.add(key);
    const source = await nested.send(path, 'Debugger.getScriptSource', {
      scriptId: params.scriptId,
    });
    const offset = source.scriptSource.indexOf(CONSUME_REPLY_GUARD);
    if (offset === -1) return;
    await nested.send(path, 'Debugger.setBreakpoint', {
      location: { scriptId: params.scriptId, ...sourceLocation(source.scriptSource, offset) },
    });
  }

  async function captureGuard(path, params) {
    const frames = params.callFrames ?? [];
    const top = frames[0];
    const guardHit =
      top?.functionName === 'consumeReply' && (params.hitBreakpoints ?? []).length > 0;
    if (!guardHit) {
      await nested.send(path, 'Debugger.resume').catch(() => undefined);
      return;
    }
    if (capturing) {
      await nested.send(path, 'Debugger.resume').catch(() => undefined);
      return;
    }
    capturing = true;
    try {
      const frameLocals = [];
      for (const frame of frames.slice(0, 8)) {
        frameLocals.push({
          functionName: frame.functionName,
          locals: await localProperties(path, frame),
        });
      }
      const consumeLocals = frameLocals[0]?.locals ?? [];
      capture = {
        elapsedMs: Date.now() - startedAt,
        phase: {
          ...phase,
          elapsedMs: Date.now() - phase.enteredAt,
        },
        target: targetByPath.get(path.join('/')),
        nativeWaitResult: await evaluate(
          path,
          top.callFrameId,
          'globalThis.__riftySabLastWaitResult',
        ),
        preGuardHeader:
          consumeLocals.find(
            (entry) =>
              typeof entry.value === 'string' && entry.value.startsWith('header: version='),
          )?.value ?? null,
        guardBranchReached: true,
        headerAtBreakpoint: await evaluate(path, top.callFrameId, 'this.headerState()'),
        rawHeaderAtBreakpoint: await evaluate(path, top.callFrameId, 'Array.from(this.i32)'),
        process: await evaluate(
          path,
          top.callFrameId,
          '({href: globalThis.location?.href, pid: globalThis.process?.pid, argv: globalThis.process?.argv})',
        ),
        stack: frames.map((frame) => ({
          functionName: frame.functionName,
          url:
            frame.url ||
            scriptUrlByPathAndId.get(`${path.join('/')}:${frame.location.scriptId}`) ||
            '',
          location: frame.location,
        })),
        frameLocals,
      };
      console.log(`[sab-lifecycle-capture]\n${JSON.stringify(capture, null, 2)}`);
      resolveCapture(capture);
    } finally {
      await nested.send(path, 'Debugger.resume').catch(() => undefined);
    }
  }

  async function initializeTarget(path, targetInfo, waitingForDebugger) {
    const pathName = path.join('/');
    if (initializing.has(pathName)) return;
    initializing.add(pathName);
    targetByPath.set(pathName, targetInfo);
    try {
      await nested.send(path, 'Debugger.enable');
      await nested.send(path, 'Runtime.evaluate', {
        expression: `(() => {
          if (globalThis.__riftySabWaitProbeInstalled === true) return;
          const nativeWait = Atomics.wait;
          globalThis.__riftySabWaitProbeInstalled = true;
          Atomics.wait = function riftySabWaitProbe() {
            const result = Reflect.apply(nativeWait, Atomics, arguments);
            globalThis.__riftySabLastWaitResult = result;
            return result;
          };
        })()`,
      });
      await nested.send(path, 'Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: false,
      });
    } finally {
      if (waitingForDebugger) {
        await nested.send(path, 'Runtime.runIfWaitingForDebugger').catch(() => undefined);
      }
    }
  }

  async function runCarrier() {
    await root.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: false,
    });
    await page.goto('/');
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 30_000,
    });
    await expect(page.locator('[data-testid="launcher"]')).toBeVisible({ timeout: 90_000 });
    await pickStarter(page, 'webpack-dev-server');

    const startup = (async () => {
      await expectTerminalContains(page, '> webpack serve', 180_000);
      await expect(
        page.locator('.rf-livepill[data-state="running"]', { hasText: 'LIVE :5184' }),
      ).toBeVisible({ timeout: 180_000 });
      await expect(page.frameLocator('iframe[title="Preview port 5184"]').locator('h1')).toHaveText(
        'Create App style project',
        { timeout: 120_000 },
      );
      return 'live';
    })();
    void startup.catch(() => undefined);
    if ((await Promise.race([startup, captureReady.then(() => 'captured')])) === 'captured') return;

    for (let cycle = 1; cycle <= CYCLES && capture === undefined; cycle += 1) {
      phase = { state: 'frozen', cycle, enteredAt: Date.now() };
      await root.send('Page.setWebLifecycleState', { state: 'frozen' });
      const duringFrozen = await Promise.race([
        captureReady.then(() => true),
        delay(PHASE_MS).then(() => false),
      ]);

      phase = { state: 'active', cycle, enteredAt: Date.now() };
      await root.send('Page.setWebLifecycleState', { state: 'active' });
      if (duringFrozen) break;
      await Promise.race([captureReady, delay(PHASE_MS)]);
    }

    expect(
      capture,
      `no consumeReply guard hit after ${String(CYCLES)} lifecycle cycles`,
    ).toBeDefined();
  }

  try {
    await Promise.race([runCarrier(), harnessFailure]);
  } finally {
    await root.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => undefined);
    await root.detach().catch(() => undefined);
    console.log('[sab-lifecycle-cleanup] page active; root CDP session detached');
  }
});
