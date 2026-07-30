/**
 * CLI report template — run-to-completion worker path + physical Node eval.
 *
 * Every differential below gives native Node and the visible Workbench
 * terminal the same raw argv. Workbench alone owns shell tokenisation, Node
 * option classification, launch construction, and supervised-child execution.
 */
import { type ChildProcess, type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type Page, expect, test } from '@playwright/test';
import {
  type NodeCliEvalFrame,
  type NodeCliEvalRawOutcome,
  assertNodeCliEvalOracleVersion,
  createNodeCliEvalCapture,
} from '../../tools/node-parity-runner/src/node-cli-eval.ts';
import {
  type TerminalSessionTarget,
  capturePageProblems,
  expectTerminalContains,
  openShellTerminal,
  runTerminalLine,
  runTerminalLineSettled,
  selectPreset,
  terminalBuffer,
  terminalHistoryExitCode,
} from './helpers/playground.ts';

const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'gu');
const FIXTURE_FILES = {
  'fixtures/a/marker.cjs':
    "module.exports={marker:'a',parentId:module.parent?.id,parentFilename:module.parent?.filename}\n",
  'fixtures/a/node_modules/eval-package/index.js': "module.exports='package-a'\n",
  'fixtures/b/marker.cjs':
    "module.exports={marker:'b',parentId:module.parent?.id,parentFilename:module.parent?.filename}\n",
  'fixtures/b/node_modules/eval-package/index.js': "module.exports='package-b'\n",
} as const;

interface PhysicalNodeInvocation {
  readonly label: string;
  readonly cwd: '/fixtures/a' | '/fixtures/b';
  /** Exact argv after process.execPath; the only eval carrier in this test. */
  readonly nodeArgv: readonly string[];
}

interface HostFixture {
  readonly root: string;
  cwd(logicalCwd: PhysicalNodeInvocation['cwd']): string;
  close(): void;
}

interface WorkbenchOutcome {
  readonly line: string;
  readonly output: string;
  readonly exitCode: number;
}

interface RunningHostInvocation {
  readonly child: ChildProcess;
  readonly outcome: Promise<NodeCliEvalRawOutcome>;
}

const identitySource =
  "const fs=require('node:fs');const path=require('node:path');const cwd=process.cwd();const visible=fs.readdirSync(cwd).sort();const child=require('./marker.cjs');const pkg=require('eval-package');const before=require.resolve('./marker.cjs');const paths=[];let cursor=cwd;for(;;){paths.push(path.join(cursor,'node_modules'));if(cursor==='/')break;cursor=path.dirname(cursor)}process.chdir('/');const after=require.resolve('./marker.cjs');console.log(JSON.stringify({argv:[process.argv[0]===process.execPath,...process.argv.slice(1)],argv0Identity:process.argv0===(process.platform==='rifty'?'rifty':process.execPath),execArgv:process.execArgv,filename:__filename,dirname:__dirname,module:{id:module.id,filename:module.filename===path.resolve(cwd,'[eval]'),path:module.path,paths:JSON.stringify(module.paths)===JSON.stringify(paths),parent:module.parent??null,loaded:module.loaded},requireMain:require.main??null,mainModule:process.mainModule??null,thisGlobal:this===globalThis,argumentsType:typeof arguments,cached:Object.values(require.cache).includes(module),noEvalCarrier:JSON.stringify(visible)===JSON.stringify(['marker.cjs','node_modules']),resolvedBefore:before===path.join(cwd,'marker.cjs'),resolvedAfter:after===path.join(cwd,'marker.cjs'),child:{marker:child.marker,parentId:child.parentId,parentFilename:child.parentFilename===path.resolve(cwd,'[eval]')},pkg}))";
const identityInvocation: PhysicalNodeInvocation = {
  label: 'identity',
  cwd: '/fixtures/a',
  nodeArgv: ['--eval', identitySource, '--', 'alpha', 'two words', '-x'],
};

const orderedInvocation: PhysicalNodeInvocation = {
  label: 'ordered-streams',
  cwd: '/fixtures/a',
  nodeArgv: [
    '-e',
    "console.log('EVAL_ORDER:stdout-first');setTimeout(()=>console.error('EVAL_ORDER:stderr-second'),5);setTimeout(()=>console.log('EVAL_ORDER:stdout-last'),10)",
    'alpha',
  ],
};
const failureInvocation: PhysicalNodeInvocation = {
  label: 'throw',
  cwd: '/fixtures/a',
  nodeArgv: ['-e', "throw new Error('physical-boom')"],
};

const lifecycleInvocations = [
  {
    label: 'timer-drain-before-print',
    cwd: '/fixtures/a',
    nodeArgv: [
      '-p',
      "const value={phase:'before'};value.self=value;setTimeout(()=>{console.log('EVAL_LIFECYCLE:timer');value.phase='after'},0);value",
    ],
  },
  {
    label: 'natural-exit-code',
    cwd: '/fixtures/a',
    nodeArgv: ['-p', 'process.exitCode=7;42'],
  },
  {
    label: 'forced-exit-suppresses-print',
    cwd: '/fixtures/a',
    nodeArgv: ['-p', 'process.exit(7);42'],
  },
] as const satisfies readonly PhysicalNodeInvocation[];

function previewInvocation(
  label: 'preview-a' | 'preview-b',
  cwd: PhysicalNodeInvocation['cwd'],
  spelling: '-e' | '--eval=',
  argument: 'alpha' | 'beta',
  port: number,
): PhysicalNodeInvocation {
  const source =
    "const fs=require('node:fs');const http=require('node:http');const path=require('node:path');const child=require('./marker.cjs');const label=process.argv[1];const port=Number(process.argv[2]);const body=JSON.stringify({label,args:process.argv.slice(1),cwd:path.basename(process.cwd()),execArgv:process.execArgv,moduleId:module.id,cached:Object.values(require.cache).includes(module),child:{marker:child.marker,parentId:child.parentId},visible:fs.readdirSync('.').sort()});http.createServer((_req,res)=>res.end(body)).listen(port,()=>console.log('EVAL_PREVIEW_READY:'+label+':'+port))";
  return {
    label,
    cwd,
    nodeArgv:
      spelling === '-e'
        ? [spelling, source, argument, String(port)]
        : [`${spelling}${source}`, argument, String(port)],
  };
}

function shellWord(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function workbenchLine(invocation: PhysicalNodeInvocation): string {
  return `cd ${shellWord(invocation.cwd)} && node ${invocation.nodeArgv.map(shellWord).join(' ')}`;
}

function settledCommandOutput(buffer: string, line: string): string {
  const normalized = buffer.replaceAll('\r\n', '\n');
  const marker = `> ${line}`;
  const start = normalized.lastIndexOf(marker);
  if (start < 0) throw new Error(`terminal command marker missing: ${line}`);
  const afterCommand = normalized.slice(start + marker.length).replace(/^\n/u, '');
  const end = afterCommand.lastIndexOf('\n> ');
  if (end < 0) throw new Error(`terminal completion prompt missing: ${line}`);
  return afterCommand.slice(0, end).trimEnd();
}

function createHostFixture(): HostFixture {
  const root = mkdtempSync(join(tmpdir(), 'rifty-workbench-eval-'));
  for (const [relativePath, source] of Object.entries(FIXTURE_FILES)) {
    const path = join(root, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source);
  }
  return {
    root,
    cwd: (logicalCwd) => join(root, logicalCwd.slice(1)),
    close: () => rmSync(root, { recursive: true, force: true }),
  };
}

async function materializeWorkbenchFixtures(page: Page): Promise<void> {
  const directories = new Set(
    Object.keys(FIXTURE_FILES).map((relativePath) => `/${dirname(relativePath)}`),
  );
  for (const directory of directories) {
    await runTerminalLineSettled(page, `mkdir -p ${shellWord(directory)}`);
  }
  for (const [relativePath, source] of Object.entries(FIXTURE_FILES)) {
    await runTerminalLineSettled(
      page,
      `printf '%s' ${shellWord(source.trimEnd())} > ${shellWord(`/${relativePath}`)}`,
    );
  }
}

function startHostInvocation(
  fixture: HostFixture,
  invocation: PhysicalNodeInvocation,
): RunningHostInvocation {
  assertNodeCliEvalOracleVersion(process.version);
  const capture = createNodeCliEvalCapture();
  const child = spawn(process.execPath, [...invocation.nodeArgv], {
    cwd: fixture.cwd(invocation.cwd),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk: unknown) => capture.push('stdout', chunk));
  child.stderr.on('data', (chunk: unknown) => capture.push('stderr', chunk));
  const outcome = new Promise<NodeCliEvalRawOutcome>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      resolve(capture.finish(code, signal));
    });
  });
  return { child, outcome };
}

function runHostInvocation(
  fixture: HostFixture,
  invocation: PhysicalNodeInvocation,
): Promise<NodeCliEvalRawOutcome> {
  return startHostInvocation(fixture, invocation).outcome;
}

async function runWorkbenchInvocation(
  page: Page,
  invocation: PhysicalNodeInvocation,
): Promise<WorkbenchOutcome> {
  const line = workbenchLine(invocation);
  await runTerminalLineSettled(page, line, 60_000);
  const output = settledCommandOutput(await terminalBuffer(page), line);
  const exitCode = await terminalHistoryExitCode(page, line);
  return { line, output, exitCode };
}

function normalized(text: string): string {
  return text.replace(ANSI_SGR, '').replaceAll('\r\n', '\n').trimEnd();
}

function evalErrorProjection(text: string): string {
  const lines = normalized(text).split('\n');
  const header = lines.findIndex((line) => /^\[eval\]:\d+/u.test(line));
  const error = lines.findIndex(
    (line, index) => index > header && /^(?:[A-Za-z][A-Za-z0-9_.]*Error|Error):/u.test(line),
  );
  if (header < 0 || error < 0) return normalized(text);
  const blank = lines.findIndex((line, index) => index > header && line === '');
  const preludeEnd = blank < 0 ? error : blank;
  const userFrame = lines.find((line, index) => index > error && /^\s+at \[eval\]:/u.test(line));
  return [...lines.slice(header, preludeEnd), '', lines[error], userFrame]
    .filter((line): line is string => line !== undefined)
    .join('\n');
}

function orderedMarkerFrames(frames: readonly NodeCliEvalFrame[]): readonly NodeCliEvalFrame[] {
  return frames
    .map((frame) => ({ ...frame, text: normalized(frame.text) }))
    .filter((frame) => frame.text.startsWith('EVAL_ORDER:'));
}

async function renderedMarkerColors(
  page: Page,
  target: TerminalSessionTarget | 'active',
  markers: readonly string[],
): Promise<readonly (string | null)[]> {
  const slot =
    target === 'active'
      ? page.locator('.rf-terminal-slot[data-active="true"]')
      : page.locator(`.rf-terminal-slot[data-session-id="${target.sessionId}"]`);
  return slot.locator('.xterm-rows').evaluate(
    (rows, expectedMarkers) => {
      const spans = [...rows.querySelectorAll('span')].reverse();
      return expectedMarkers.map((marker) => {
        const span = spans.find((candidate) => candidate.textContent?.includes(marker));
        return span === undefined ? null : getComputedStyle(span).color;
      });
    },
    [...markers],
  );
}

async function bootCliReport(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
    timeout: 15_000,
  });
  await selectPreset(page, 'cli-report');
  await expectTerminalContains(page, 'cli: running CLI report', 120_000);
  await expectTerminalContains(page, 'npm: + yaml@', 120_000);
  await expectTerminalContains(page, '[cli] package report', 30_000);
  await expectTerminalContains(page, '[cli] packages=3 -> api, docs, jobs', 30_000);
  await expectTerminalContains(page, '[cli] completed with exit code 0', 120_000);
  await expect(page.locator('iframe[title^="Preview port"]')).toHaveCount(0);
  await openShellTerminal(page);
  await materializeWorkbenchFixtures(page);
}

interface RunningHostPreview {
  readonly child: ChildProcessWithoutNullStreams;
  readonly ready: Promise<void>;
  readonly outcome: Promise<NodeCliEvalRawOutcome>;
}

function startHostPreview(
  fixture: HostFixture,
  invocation: PhysicalNodeInvocation,
): RunningHostPreview {
  assertNodeCliEvalOracleVersion(process.version);
  const capture = createNodeCliEvalCapture();
  const child = spawn(process.execPath, [...invocation.nodeArgv], {
    cwd: fixture.cwd(invocation.cwd),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let readySettled = false;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  child.stdout.on('data', (chunk: unknown) => {
    capture.push('stdout', chunk);
    stdout += String(chunk);
    if (!readySettled && stdout.includes(`EVAL_PREVIEW_READY:${invocation.label}:`)) {
      readySettled = true;
      resolveReady();
    }
  });
  child.stderr.on('data', (chunk: unknown) => capture.push('stderr', chunk));
  const outcome = new Promise<NodeCliEvalRawOutcome>((resolve, reject) => {
    child.once('error', (error) => {
      if (!readySettled) {
        readySettled = true;
        rejectReady(error);
      }
      reject(error);
    });
    child.once('close', (code, signal) => {
      const result = capture.finish(code, signal);
      if (!readySettled) {
        readySettled = true;
        rejectReady(new Error(`${invocation.label} exited before listening:\n${result.stderr}`));
      }
      resolve(result);
    });
  });
  return { child, ready, outcome };
}

async function fetchHostPreview(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${String(port)}/`);
  expect(response.ok).toBe(true);
  return response.text();
}

async function fetchWorkbenchPreview(page: Page, port: number): Promise<string> {
  return page.evaluate(async (previewPort) => {
    const response = await fetch(`/preview/${String(previewPort)}/`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`preview ${String(previewPort)} returned ${response.status}`);
    return response.text();
  }, port);
}

async function stopWorkbenchPreview(
  page: Page,
  target: TerminalSessionTarget,
  line: string,
): Promise<number> {
  const tab = page.locator(`.rf-terminal-tab__select[data-session-id="${target.sessionId}"]`);
  await tab.click();
  await expect(tab).toHaveAttribute('aria-selected', 'true');
  const slot = page.locator(`.rf-terminal-slot[data-session-id="${target.sessionId}"]`);
  await slot.locator('[data-testid="terminal"]').click();
  await page.keyboard.press('Control+c');
  await expect(tab.locator('..')).toHaveAttribute('data-running', 'false', { timeout: 30_000 });
  return terminalHistoryExitCode(page, line, target);
}

test.describe('CLI report template through the worker lifecycle', () => {
  test.describe.configure({ mode: 'serial' });

  test('native oracle waits for inherited stdio pipes to close after direct-child exit', async ({
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'native oracle regression runs once');
    const fixture = createHostFixture();
    const invocation: PhysicalNodeInvocation = {
      label: 'native-inherited-pipe-drain',
      cwd: '/fixtures/a',
      nodeArgv: [
        '-e',
        "const{spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',\"setTimeout(()=>process.stdout.write('EVAL_CAPTURE:late\\\\n'),100)\"],{stdio:['ignore',process.stdout,process.stderr]});child.unref();process.stdout.write('EVAL_CAPTURE:direct\\n')",
      ],
    };
    try {
      const running = startHostInvocation(fixture, invocation);
      let captureSettled = false;
      const outcome = running.outcome.then((result) => {
        captureSettled = true;
        return result;
      });
      await new Promise<void>((resolve, reject) => {
        running.child.once('exit', () => resolve());
        running.child.once('error', reject);
      });
      await Promise.resolve();
      expect(captureSettled).toBe(false);
      expect(await outcome).toMatchObject({
        stdout: 'EVAL_CAPTURE:direct\nEVAL_CAPTURE:late\n',
        stderr: '',
        code: 0,
        signal: null,
      });
    } finally {
      fixture.close();
    }
  });

  test('preset exits cleanly and raw Node eval reaches physical Workbench identity/cache semantics', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'physical supervised children require Chromium');
    test.setTimeout(180_000);
    const problems = capturePageProblems(page);
    const fixture = createHostFixture();
    try {
      await bootCliReport(page);

      const native = await runHostInvocation(fixture, identityInvocation);
      expect({ code: native.code, signal: native.signal, stderr: native.stderr }).toEqual({
        code: 0,
        signal: null,
        stderr: '',
      });
      const browser = await runWorkbenchInvocation(page, identityInvocation);
      expect(browser.exitCode).toBe(native.code);
      expect(browser.output).toBe(normalized(native.stdout));
      problems.assertNoViteImportErrors();
    } finally {
      fixture.close();
    }
  });

  test('physical terminal preserves stdout/stderr order and exact failed eval status/frame', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'physical supervised children require Chromium');
    test.setTimeout(180_000);
    const problems = capturePageProblems(page);
    const fixture = createHostFixture();
    try {
      await bootCliReport(page);

      const nativeOrder = await runHostInvocation(fixture, orderedInvocation);
      const browserOrder = await runWorkbenchInvocation(page, orderedInvocation);
      const nativeFrames = orderedMarkerFrames(nativeOrder.frames);
      expect(nativeFrames.map(({ stream }) => stream)).toEqual(['stdout', 'stderr', 'stdout']);
      expect(
        browserOrder.output.split('\n').filter((line) => line.startsWith('EVAL_ORDER:')),
      ).toEqual(nativeFrames.map(({ text }) => text));
      const [stdoutFirstColor, stderrColor, stdoutLastColor] = await renderedMarkerColors(
        page,
        'active',
        ['EVAL_ORDER:stdout-first', 'EVAL_ORDER:stderr-second', 'EVAL_ORDER:stdout-last'],
      );
      expect(stdoutFirstColor).not.toBeNull();
      expect(stderrColor).not.toBeNull();
      expect(stdoutLastColor).toBe(stdoutFirstColor);
      expect(stderrColor).not.toBe(stdoutFirstColor);
      expect(browserOrder.exitCode).toBe(nativeOrder.code);

      const nativeFailure = await runHostInvocation(fixture, failureInvocation);
      const browserFailure = await runWorkbenchInvocation(page, failureInvocation);
      expect(browserFailure.exitCode).toBe(nativeFailure.code);
      expect(nativeFailure.code).toBe(1);
      expect(evalErrorProjection(`${browserFailure.output}\n`)).toBe(
        evalErrorProjection(nativeFailure.stderr),
      );
      problems.assertNoViteImportErrors();
    } finally {
      fixture.close();
    }
  });

  test('physical print completion drains, honors exitCode, and forced exit suppresses output', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'physical supervised children require Chromium');
    test.setTimeout(180_000);
    const problems = capturePageProblems(page);
    const fixture = createHostFixture();
    try {
      await bootCliReport(page);
      for (const invocation of lifecycleInvocations) {
        const native = await runHostInvocation(fixture, invocation);
        const browser = await runWorkbenchInvocation(page, invocation);
        expect(browser.output, invocation.label).toBe(normalized(native.stdout));
        expect(browser.exitCode, invocation.label).toBe(native.code);
      }
      problems.assertNoViteImportErrors();
    } finally {
      fixture.close();
    }
  });

  test('two simultaneous raw eval children keep cwd/module/cache/output/preview scopes isolated', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'physical supervised children require Chromium');
    test.setTimeout(240_000);
    const problems = capturePageProblems(page);
    const fixture = createHostFixture();
    const portBase = 40_000 + (process.pid % 1_000) * 2;
    const invocationA = previewInvocation('preview-a', '/fixtures/a', '-e', 'alpha', portBase);
    const invocationB = previewInvocation(
      'preview-b',
      '/fixtures/b',
      '--eval=',
      'beta',
      portBase + 1,
    );
    const hostA = startHostPreview(fixture, invocationA);
    const hostB = startHostPreview(fixture, invocationB);
    try {
      await Promise.all([hostA.ready, hostB.ready]);
      const [nativeA, nativeB] = await Promise.all([
        fetchHostPreview(portBase),
        fetchHostPreview(portBase + 1),
      ]);

      await bootCliReport(page);
      const terminalA = await openShellTerminal(page);
      const terminalB = await openShellTerminal(page);
      const lineA = workbenchLine(invocationA);
      const lineB = workbenchLine(invocationB);
      await runTerminalLine(page, lineA, terminalA);
      await runTerminalLine(page, lineB, terminalB);

      await expect
        .poll(() => terminalBuffer(page, terminalA), { timeout: 60_000 })
        .toContain(`EVAL_PREVIEW_READY:${invocationA.label}:${String(portBase)}`);
      await expect
        .poll(() => terminalBuffer(page, terminalB), { timeout: 60_000 })
        .toContain(`EVAL_PREVIEW_READY:${invocationB.label}:${String(portBase + 1)}`);

      const switcher = page.locator('.rf-preview__switcher');
      await expect(switcher.locator('option', { hasText: `:${String(portBase)}` })).toHaveCount(1);
      await expect(switcher.locator('option', { hasText: `:${String(portBase + 1)}` })).toHaveCount(
        1,
      );
      const [browserA, browserB] = await Promise.all([
        fetchWorkbenchPreview(page, portBase),
        fetchWorkbenchPreview(page, portBase + 1),
      ]);
      expect(browserA).toBe(nativeA);
      expect(browserB).toBe(nativeB);
      expect(JSON.parse(browserA)).toMatchObject({
        label: 'alpha',
        cwd: 'a',
        moduleId: '[eval]',
        cached: false,
        child: { marker: 'a', parentId: '[eval]' },
      });
      expect(JSON.parse(browserB)).toMatchObject({
        label: 'beta',
        cwd: 'b',
        moduleId: '[eval]',
        cached: false,
        child: { marker: 'b', parentId: '[eval]' },
      });

      expect(await stopWorkbenchPreview(page, terminalA, lineA)).toBe(130);
      await expect(switcher.locator('option', { hasText: `:${String(portBase)}` })).toHaveCount(0);
      await expect(switcher.locator('option', { hasText: `:${String(portBase + 1)}` })).toHaveCount(
        1,
      );
      expect(await fetchWorkbenchPreview(page, portBase + 1)).toBe(nativeB);
      expect(await stopWorkbenchPreview(page, terminalB, lineB)).toBe(130);
      await expect(page.locator('option', { hasText: `:${String(portBase + 1)}` })).toHaveCount(0);
      problems.assertNoViteImportErrors();
    } finally {
      hostA.child.kill('SIGTERM');
      hostB.child.kill('SIGTERM');
      await Promise.allSettled([hostA.outcome, hostB.outcome]);
      fixture.close();
    }
  });
});
