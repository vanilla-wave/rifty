import { type Page, expect } from '@playwright/test';

const workspacePath = process.cwd().replaceAll('\\', '/');
export const sealedWorkbenchFixtureUrl = `/@fs${workspacePath}/tests/browser-unit/fixtures/sealed-playground-workbench.ts`;

export interface BootOwnerOptions {
  readonly workspaceId: string;
  readonly template?: 'hidden-empty' | 'typescript' | 'vite';
  readonly root?: string;
  readonly slug?: string;
  readonly setup?: 'instant' | 'from-scratch';
  readonly starter?: string;
  readonly hiddenEmptyBoot?: boolean;
  readonly persistence?: 'required' | 'preferred' | 'ephemeral';
  readonly plan?: Readonly<Record<string, unknown>>;
}

interface OwnerExecResult {
  readonly exit: number;
  readonly out: string;
}

export interface OwnerExecOutcome {
  readonly exitCode: number;
  readonly exit: { readonly code: number | null; readonly signal: string | null };
  readonly closeExit: { readonly code: number | null; readonly signal: string | null };
  readonly closeShared: boolean;
  readonly settlements: number;
  readonly out: string;
}

export async function gotoHarness(page: Page): Promise<void> {
  await page.goto('/unit-harness.html');
  await expect(page.locator('#browser-unit-harness')).toHaveAttribute('data-status', 'ready');
}

export async function bootOwner(page: Page, options: BootOwnerOptions): Promise<void> {
  await page.evaluate(
    async ({ fixtureUrl, input }) => {
      const fixture = await import(/* @vite-ignore */ fixtureUrl);
      await fixture.openSealedWorkbenchFixture(input);
    },
    { fixtureUrl: sealedWorkbenchFixtureUrl, input: options },
  );
}

export function execLine(page: Page, line: string): Promise<OwnerExecResult> {
  return page.evaluate(
    async ({ fixtureUrl, command }) => {
      const fixture = await import(/* @vite-ignore */ fixtureUrl);
      return fixture.executeProjectLine(command);
    },
    { fixtureUrl: sealedWorkbenchFixtureUrl, command: line },
  );
}

export function execLineOutcome(page: Page, line: string): Promise<OwnerExecOutcome> {
  return page.evaluate(
    async ({ fixtureUrl, command }) => {
      const fixture = await import(/* @vite-ignore */ fixtureUrl);
      return fixture.executeProjectLineOutcome(command);
    },
    { fixtureUrl: sealedWorkbenchFixtureUrl, command: line },
  );
}

export function execLineUntil(
  page: Page,
  line: string,
  marker: string,
): Promise<{
  readonly exit: { readonly code: number | null; readonly signal: string | null };
  readonly out: string;
}> {
  return page.evaluate(
    async ({ fixtureUrl, command, marker }) => {
      const fixture = await import(/* @vite-ignore */ fixtureUrl);
      return fixture.executeProjectLineUntil(command, marker);
    },
    { fixtureUrl: sealedWorkbenchFixtureUrl, command: line, marker },
  );
}

export function runDefaultProjectOnce(
  page: Page,
): Promise<{ readonly code: number | null; readonly signal: string | null }> {
  return page.evaluate(async (fixtureUrl) => {
    const fixture = await import(/* @vite-ignore */ fixtureUrl);
    return fixture.runDefaultProjectOnce();
  }, sealedWorkbenchFixtureUrl);
}

export function seedLegacyWorkspace(
  page: Page,
  input: { readonly workspaceId: string; readonly label: string; readonly marker: string },
): Promise<void> {
  return page.evaluate(
    async ({ fixtureUrl, seed }) => {
      const fixture = await import(/* @vite-ignore */ fixtureUrl);
      await fixture.seedLegacyWorkspace(seed);
    },
    { fixtureUrl: sealedWorkbenchFixtureUrl, seed: input },
  );
}

export async function writeOwnerFile(page: Page, path: string, content: string): Promise<void> {
  await page.evaluate(
    async ({ fixtureUrl, file }) => {
      const fixture = await import(/* @vite-ignore */ fixtureUrl);
      await fixture.writeProjectText(file.path, file.content);
    },
    { fixtureUrl: sealedWorkbenchFixtureUrl, file: { path, content } },
  );
}

export async function flushOwnerDurable(page: Page): Promise<void> {
  await page.evaluate(async (fixtureUrl) => {
    const fixture = await import(/* @vite-ignore */ fixtureUrl);
    await fixture.awaitProjectDurability();
  }, sealedWorkbenchFixtureUrl);
}

export function readOwnerFile(
  page: Page,
  path: string,
): Promise<{ ok: boolean; text: string; error: string }> {
  return page.evaluate(
    async ({ fixtureUrl, filePath }) => {
      const fixture = await import(/* @vite-ignore */ fixtureUrl);
      return fixture.readProjectText(filePath);
    },
    { fixtureUrl: sealedWorkbenchFixtureUrl, filePath: path },
  );
}

export async function removeOwnerPath(page: Page, path: string, recursive = false): Promise<void> {
  await page.evaluate(
    async ({ fixtureUrl, filePath, recursive }) => {
      const fixture = await import(/* @vite-ignore */ fixtureUrl);
      await fixture.removeProjectPath(filePath, recursive);
    },
    { fixtureUrl: sealedWorkbenchFixtureUrl, filePath: path, recursive },
  );
}

export async function closeOwner(page: Page): Promise<void> {
  await page.evaluate(async (fixtureUrl) => {
    const fixture = await import(/* @vite-ignore */ fixtureUrl);
    await fixture.closeSealedWorkbenchFixture();
  }, sealedWorkbenchFixtureUrl);
}
