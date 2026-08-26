#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { orchestrateChildFs } from './src/child-fs-orchestrator.mjs';
import {
  admitChildFsRun,
  assertChildFsPortFree,
  publishChildFsArtifact,
} from './src/child-fs-runner.mjs';

const REPO_ROOT = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const PLAYGROUND_ROOT = resolve(REPO_ROOT, 'apps/playground');
const ORCHESTRATOR_FIXTURE = `/@fs${REPO_ROOT.replaceAll('\\', '/')}/tests/browser-unit/fixtures/child-fs-orchestrator.ts`;

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function waitForHttp(url, stopped) {
  let lastError;
  for (;;) {
    if (stopped()) throw new Error('child fs dev server readiness cancelled');
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await sleep(250);
  }
}

function startServer(port) {
  const child = spawn('pnpm', ['exec', 'vite', '--force'], {
    cwd: PLAYGROUND_ROOT,
    env: { ...process.env, RIFTY_PLAYGROUND_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let closing = false;
  let stopped = false;
  let tail = '';
  const append = (chunk) => {
    tail = `${tail}${String(chunk)}`.slice(-32_000);
  };
  child.stdout.on('data', append);
  child.stderr.on('data', append);
  let rejectFailed;
  const failed = new Promise((_, reject) => {
    rejectFailed = reject;
  });
  const exited = new Promise((resolveExit) => {
    child.once('error', (error) => {
      if (!closing) rejectFailed(error);
      resolveExit();
    });
    child.once('exit', (code, signal) => {
      if (!closing) {
        rejectFailed(
          new Error(`child fs dev server exited (${String(code)}/${String(signal)})\n${tail}`),
        );
      }
      resolveExit();
    });
  });
  const baseUrl = `http://localhost:${port}`;
  return Promise.resolve({
    ready: waitForHttp(`${baseUrl}/unit-harness.html`, () => stopped),
    failed,
    async close() {
      closing = true;
      stopped = true;
      if (child.exitCode !== null || child.signalCode !== null) return;
      child.kill('SIGTERM');
      await exited;
    },
  });
}

async function launchBrowser(baseUrl) {
  const browser = await chromium.launch({ headless: true });
  let closing = false;
  let rejectFailed;
  const failed = new Promise((_, reject) => {
    rejectFailed = reject;
  });
  try {
    const page = await browser.newPage();
    page.on('crash', () => rejectFailed(new Error('child fs browser page crashed')));
    page.on('close', () => {
      if (!closing) rejectFailed(new Error('child fs browser page closed early'));
    });
    browser.on('disconnected', () => {
      if (!closing) rejectFailed(new Error('child fs Chromium disconnected early'));
    });
    await page.goto(`${baseUrl}/unit-harness.html`, { waitUntil: 'load' });
    return {
      version: browser.version(),
      failed,
      runSample: (lane, ordinal) =>
        page.evaluate(
          async ({ fixtureUrl, lane: requestedLane, ordinal: requestedOrdinal }) => {
            const fixture = await import(/* @vite-ignore */ fixtureUrl);
            return await fixture.runChildFsBrowserSample(requestedLane, requestedOrdinal);
          },
          { fixtureUrl: ORCHESTRATOR_FIXTURE, lane, ordinal },
        ),
      async close() {
        closing = true;
        await browser.close();
      },
    };
  } catch (error) {
    closing = true;
    await browser.close().catch(() => {});
    throw error;
  }
}

async function launch(options) {
  const gitSha = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  }).trim();
  const artifact = await orchestrateChildFs(
    {
      ...options,
      out: resolve(REPO_ROOT, options.out),
      generatedAt: new Date().toISOString(),
      gitSha,
    },
    {
      startServer,
      launchBrowser,
      publish: publishChildFsArtifact,
    },
  );
  console.log(
    `child fs artifact → ${resolve(REPO_ROOT, options.out)} (${artifact.samples.length} samples)`,
  );
}

await admitChildFsRun(process.argv.slice(2), {
  assertPortFree: assertChildFsPortFree,
  launch,
});
