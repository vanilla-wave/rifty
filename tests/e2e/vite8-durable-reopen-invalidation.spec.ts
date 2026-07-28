import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { type BrowserContext, type Page, expect, test } from '@playwright/test';
import {
  expectTerminalContains,
  expectViteDevServerReady,
  openShellTerminal,
  pickStarter,
  readActiveProjectText,
  runTerminalLine,
  runTerminalLineSettled,
  terminalBuffer,
} from './helpers/playground.ts';
import { createVite8CrossBuildHarness } from './helpers/vite8-cross-build.ts';

const OWNER_TIMEOUT = 180_000;
const REPO = realpathSync(process.cwd());
const OLD_SNAPSHOT_ID = 'sha256:2b1af80918c6485aa910abac93d8db80b173b93ad5eff3c295829cbdb218c582';
const CURRENT_SNAPSHOT_ID =
  'sha256:5630dc5182746653c6aaf4d67156fec81e45706806d056e1256077ce6d61c0da';
const INSTALL_ARTIFACT_ID =
  'sha256:de9e5426b878f6dda62f03b119e74a7b90dc71e29a859cc5625e196cf88c282d';
const OLD_LOCKFILE_SHA256 = 'b3a9d99a1e207ca4e15976050f45460e40505077c8709cafc6ff301131958031';
const CURRENT_LOCKFILE_SHA256 = '64aceec273c90e7ae52264bbb604a5d95bf79884860ad6f25145bf828667089f';

interface PackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly overrides?: Readonly<Record<string, string>>;
}

interface InstallStamp {
  readonly version: number;
  readonly root: string;
  readonly slug: string;
  readonly packageJsonText: string;
  readonly installArtifactIdentity: string;
  readonly lockfileSha256?: string;
  readonly deps: Readonly<Record<string, string>>;
  readonly packages: number;
  readonly durability?: string;
  readonly epoch?: string;
}

interface DefinitionProof {
  readonly definitionIdentitySha256: string;
  readonly catalogMatchesDefinition: boolean;
  readonly expectedBuildIdentityMatches: boolean;
  readonly snapshotId: string;
}

interface MismatchToastState {
  readonly chip: string | null;
  readonly liveCount: number;
  readonly projectAActive: string | null;
  readonly projectBActive: string | null;
}

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

async function openProjects(page: Page): Promise<void> {
  const launcher = page.locator('[data-testid="launcher"]');
  if (!(await launcher.isVisible({ timeout: 0 }).catch(() => false))) {
    await page.locator('[data-action="open-launcher"]').click();
  }
  await expect(launcher).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: /^Projects/ }).click();
}

async function saveScratchAs(page: Page, name: string): Promise<string> {
  await openProjects(page);
  await page.locator('[data-action="save-scratch"]').click();
  const dialog = page.locator('.rf-dialog[role="dialog"]');
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await dialog.locator('input.rf-dialog__input').fill(name);
  await dialog.getByRole('button', { name: 'Save project', exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: OWNER_TIMEOUT });
  const card = page.locator('.rf-pcard[data-project]', { hasText: name }).first();
  await expect(card).toHaveAttribute('data-active', 'true', { timeout: OWNER_TIMEOUT });
  const projectId = await card.getAttribute('data-project');
  if (projectId === null || projectId.length === 0) {
    throw new Error(`Saved project ${name} has no durable id`);
  }
  await page.locator('.rf-launcher__close').click();
  await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0);
  return projectId;
}

function projectCard(page: Page, projectId: string) {
  return page.locator(`.rf-pcard[data-project="${projectId}"]`);
}

async function expectActiveProject(
  page: Page,
  expected: {
    readonly name: string;
    readonly activeId: string;
    readonly inactiveId: string;
  },
): Promise<void> {
  await expect(page.locator('[data-action="open-launcher"] .rf-chip__name')).toHaveText(
    expected.name,
    { timeout: OWNER_TIMEOUT },
  );
  await expect(page.locator('.rf-livepill[data-state="running"]')).toHaveCount(1, {
    timeout: OWNER_TIMEOUT,
  });
  if (
    !(await page
      .locator('[data-testid="launcher"]')
      .isVisible()
      .catch(() => false))
  ) {
    await openProjects(page);
  }
  await expect(projectCard(page, expected.activeId)).toHaveAttribute('data-active', 'true');
  await expect(projectCard(page, expected.inactiveId)).toHaveAttribute('data-active', 'false');
}

async function switchProject(page: Page, projectId: string): Promise<void> {
  await openProjects(page);
  await expect(projectCard(page, projectId)).toHaveAttribute('role', 'button', {
    timeout: OWNER_TIMEOUT,
  });
  await projectCard(page, projectId).click();
  await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0, {
    timeout: OWNER_TIMEOUT,
  });
}

async function projectTreeDigest(
  page: Page,
  projectId: string,
): Promise<{ readonly digest: string; readonly paths: readonly string[] }> {
  return page.evaluate(async (id) => {
    type DirectoryWithEntries = FileSystemDirectoryHandle & {
      entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
    };
    let tree = await navigator.storage.getDirectory();
    for (const segment of ['.rifty', 'workbench', 'v1', 'projects', id, 'tree']) {
      tree = await tree.getDirectoryHandle(segment);
    }
    const rows: { path: string; size: number; digest: string }[] = [];
    const hex = (bytes: ArrayBuffer): string =>
      [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const walk = async (directory: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      for await (const [name, handle] of (directory as DirectoryWithEntries).entries()) {
        const path = `${prefix}/${name}`;
        if (handle.kind === 'directory') {
          await walk(handle as FileSystemDirectoryHandle, path);
          continue;
        }
        const file = await (handle as FileSystemFileHandle).getFile();
        rows.push({
          path,
          size: file.size,
          digest: hex(await crypto.subtle.digest('SHA-256', await file.arrayBuffer())),
        });
      }
    };
    await walk(tree, '');
    rows.sort((left, right) => left.path.localeCompare(right.path));
    const serialized = JSON.stringify(rows);
    return {
      digest: hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized))),
      paths: rows.map((row) => row.path),
    };
  }, projectId);
}

async function readProjectFileFromOpfs(
  page: Page,
  projectId: string,
  path: string,
): Promise<{ readonly exists: boolean; readonly text: string }> {
  return page.evaluate(
    async ({ id, relativePath }) => {
      const segments = relativePath.split('/').filter(Boolean);
      let directory = await navigator.storage.getDirectory();
      for (const segment of ['.rifty', 'workbench', 'v1', 'projects', id, 'tree']) {
        directory = await directory.getDirectoryHandle(segment);
      }
      for (const segment of segments.slice(0, -1)) {
        try {
          directory = await directory.getDirectoryHandle(segment);
        } catch (error) {
          if (error instanceof DOMException && error.name === 'NotFoundError') {
            return { exists: false, text: '' };
          }
          throw error;
        }
      }
      try {
        const handle = await directory.getFileHandle(segments.at(-1) ?? '');
        return { exists: true, text: await (await handle.getFile()).text() };
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotFoundError') {
          return { exists: false, text: '' };
        }
        throw error;
      }
    },
    { id: projectId, relativePath: path },
  );
}

async function catalogProof(
  page: Page,
): Promise<{ readonly activeId: string; readonly projectIds: readonly string[] }> {
  return page.evaluate(async () => {
    let directory = await navigator.storage.getDirectory();
    for (const segment of ['.rifty', 'workbench', 'playground']) {
      directory = await directory.getDirectoryHandle(segment);
    }
    const handle = await directory.getFileHandle('catalog.json');
    const catalog = JSON.parse(await (await handle.getFile()).text()) as {
      readonly active:
        | { readonly kind: 'scratch' }
        | { readonly kind: 'project'; readonly id: string }
        | null;
      readonly projects: readonly { readonly id: string }[];
    };
    if (catalog.active?.kind !== 'project') {
      throw new Error(`Expected active named project, observed ${catalog.active?.kind ?? 'none'}`);
    }
    return {
      activeId: catalog.active.id,
      projectIds: catalog.projects.map((project) => project.id).sort(),
    };
  });
}

async function definitionIdentityProof(page: Page, projectId: string): Promise<DefinitionProof> {
  const observed = await page.evaluate(
    async ({ id, repo }) => {
      let metadataDirectory = await navigator.storage.getDirectory();
      for (const segment of ['.rifty', 'workbench', 'v1', 'projects', id]) {
        metadataDirectory = await metadataDirectory.getDirectoryHandle(segment);
      }
      const metadataFile = await metadataDirectory.getFileHandle('definition.json');
      const metadata = JSON.parse(await (await metadataFile.getFile()).text()) as {
        readonly definitionIdentity: string;
      };

      let catalogDirectory = await navigator.storage.getDirectory();
      for (const segment of ['.rifty', 'workbench', 'playground']) {
        catalogDirectory = await catalogDirectory.getDirectoryHandle(segment);
      }
      const catalogFile = await catalogDirectory.getFileHandle('catalog.json');
      const catalog = JSON.parse(await (await catalogFile.getFile()).text()) as {
        readonly projects: readonly {
          readonly id: string;
          readonly adoption: { readonly definitionIdentity?: string };
        }[];
      };
      const entry = catalog.projects.find((candidate) => candidate.id === id);
      if (entry === undefined) throw new Error(`OPFS catalog has no project ${id}`);

      const planModulePath = '/src/adapters/playground-project-plan.ts';
      const planModule = (await import(planModulePath)) as {
        toPlaygroundProjectPlan(input: {
          readonly projectId: string;
          readonly starter: object;
          readonly setup: 'instant';
        }): {
          readonly firstMaterialization: {
            readonly kind: string;
            readonly snapshot?: { readonly snapshotId: string };
          };
        };
      };
      const starterModulePath = '/src/glue/starter.ts';
      const starterModule = (await import(starterModulePath)) as {
        starterById(id: string): object;
      };
      const definitionModulePath = `/@fs${repo}/packages/workbench/src/workbench/internal/playground-project-definition.ts`;
      const definitionModule = (await import(/* @vite-ignore */ definitionModulePath)) as {
        definePlaygroundProject(plan: object, scope: object): object;
        inspectPlaygroundProjectDefinition(
          definition: object,
          scope: object,
        ): { readonly identity: string };
      };
      const plan = planModule.toPlaygroundProjectPlan({
        projectId: id,
        starter: starterModule.starterById('vite8'),
        setup: 'instant',
      });
      const snapshotId = plan.firstMaterialization.snapshot?.snapshotId;
      if (plan.firstMaterialization.kind !== 'snapshot' || snapshotId === undefined) {
        throw new Error('Vite 8 plan has no snapshot first materialization');
      }
      const scope = Object.freeze({
        apiBaseUrl: new URL('/', location.href).href,
        clientUrl: location.href,
      });
      const definition = definitionModule.definePlaygroundProject(plan, scope);
      const expected = definitionModule.inspectPlaygroundProjectDefinition(
        definition,
        scope,
      ).identity;
      return {
        definitionIdentity: metadata.definitionIdentity,
        catalogDefinitionIdentity: entry.adoption.definitionIdentity,
        expected,
        snapshotId,
      };
    },
    { id: projectId, repo: REPO },
  );
  return {
    definitionIdentitySha256: sha256(observed.definitionIdentity),
    catalogMatchesDefinition: observed.catalogDefinitionIdentity === observed.definitionIdentity,
    expectedBuildIdentityMatches: observed.expected === observed.definitionIdentity,
    snapshotId: observed.snapshotId,
  };
}

function expectTrustedStamp(
  stamp: InstallStamp,
  expected: {
    readonly projectId: string;
    readonly packageJsonText: string;
    readonly lockfileSha256: string;
  },
): void {
  expect(stamp).toMatchObject({
    version: 4,
    root: `/.rifty/workbench/v1/projects/${expected.projectId}/tree`,
    slug: expected.projectId,
    packageJsonText: expected.packageJsonText,
    installArtifactIdentity: INSTALL_ARTIFACT_ID,
    lockfileSha256: expected.lockfileSha256,
    deps: { vite: '8.0.16' },
    packages: 20,
  });
  expect(stamp.durability).toBeUndefined();
  expect(stamp.epoch).toBeUndefined();
}

async function packageVersion(page: Page, name: string): Promise<string> {
  const file = await readActiveProjectText(page, `node_modules/${name}/package.json`, 60_000);
  expect(file.exists).toBe(true);
  return parseJson<{ readonly version: string }>(file.text).version;
}

async function runningTerminalIds(page: Page): Promise<readonly string[]> {
  return page
    .locator('.rf-terminal-tab[data-running="true"] [data-session-id]')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => node.getAttribute('data-session-id'))
        .filter((id): id is string => id !== null)
        .sort(),
    );
}

async function armFirstMismatchToastState(
  page: Page,
  projectAId: string,
  projectBId: string,
): Promise<void> {
  await page.evaluate(
    ({ projectA, projectB }) => {
      const state = window as unknown as Record<string, unknown>;
      state.__riftyFirstMismatchToastState = null;
      const project = (id: string): Element | undefined =>
        [...document.querySelectorAll('.rf-pcard[data-project]')].find(
          (card) => card.getAttribute('data-project') === id,
        );
      const observer = new MutationObserver(() => {
        if (document.querySelector('.rf-toast[data-tone="error"]') === null) return;
        state.__riftyFirstMismatchToastState = {
          chip:
            document.querySelector('[data-action="open-launcher"] .rf-chip__name')?.textContent ??
            null,
          liveCount: document.querySelectorAll('.rf-livepill[data-state="running"]').length,
          projectAActive: project(projectA)?.getAttribute('data-active') ?? null,
          projectBActive: project(projectB)?.getAttribute('data-active') ?? null,
        } satisfies MismatchToastState;
        observer.disconnect();
      });
      observer.observe(document.body, { childList: true, subtree: true });
    },
    { projectA: projectAId, projectB: projectBId },
  );
}

async function firstMismatchToastState(page: Page): Promise<MismatchToastState> {
  const read = (): Promise<MismatchToastState | null> =>
    page.evaluate(
      () =>
        ((window as unknown as Record<string, unknown>)
          .__riftyFirstMismatchToastState as MismatchToastState | null) ?? null,
    );
  await expect.poll(read, { timeout: OWNER_TIMEOUT }).not.toBeNull();
  const state = await read();
  if (state === null) throw new Error('First mismatch toast state was not captured');
  return state;
}

async function openResetDialog(page: Page, projectId: string) {
  const card = projectCard(page, projectId);
  await card.locator('.rf-pcard__menu').click();
  await card
    .locator('.rf-rowmenu')
    .getByRole('button', { name: /Reset to starter/ })
    .click();
  const dialog = page.locator('.rf-dialog[role="dialog"]');
  await expect(dialog).toContainText('Reset to starter', { timeout: 10_000 });
  return dialog;
}

async function fetchPreview(
  page: Page,
  port: number,
): Promise<{ readonly ok: boolean; readonly status: number; readonly body: string }> {
  return page.evaluate(async (targetPort) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4_000);
    try {
      const response = await fetch(`/preview/${targetPort}/`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      return { ok: response.ok, status: response.status, body: await response.text() };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        body: error instanceof Error ? error.message : String(error),
      };
    } finally {
      clearTimeout(timeout);
    }
  }, port);
}

async function proveVite8BuildAndPreview(page: Page): Promise<void> {
  await openShellTerminal(page);
  await runTerminalLineSettled(page, 'vite build', 120_000);
  await runTerminalLine(page, 'cat dist/index.html');
  await expectTerminalContains(page, /assets\/index-[^"]+\.js/u, 20_000);
  expect(await terminalBuffer(page)).not.toContain('/src/main.js');
  await runTerminalLine(page, 'vite preview');
  await expect
    .poll(() => fetchPreview(page, 4173), {
      timeout: 90_000,
      intervals: [1_000, 2_000, 4_000],
    })
    .toMatchObject({ ok: true, status: 200 });
  const preview = await fetchPreview(page, 4173);
  expect(preview.body).toMatch(/assets\/index-[^"]+\.js/u);
  expect(preview.body).not.toContain('/src/main.js');
  await expect(
    page.frameLocator('iframe[title="Preview port 4173"]').locator('#app'),
  ).toContainText('Hello from real Vite 8 (Rolldown)', { timeout: 60_000 });
}

test.describe('Vite 8 durable cross-build invalidation', () => {
  test('rejects stale A, resets it explicitly, then reopens and builds the same A offline', async ({
    page,
    context,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'OPFS + COI/SAB workspace owner — chromium only');
    test.setTimeout(900_000);

    const harness = await createVite8CrossBuildHarness();
    expect(harness.evidence).toMatchObject({
      historicalCommit: '7177b9da13732ba512ccd319d462682443c53f54',
      historicalDefinitionSha256:
        'b4b18f806e2532e37a0d0cfed83eb82f53c1fd3ee00984b0ffaa3534c289df19',
      historicalSnapshotId: OLD_SNAPSHOT_ID,
      currentSnapshotId: CURRENT_SNAPSHOT_ID,
    });
    const acquisitionRequests: string[] = [];
    const recordAcquisition = (request: { url(): string }): void => {
      const path = new URL(request.url()).pathname;
      if (path.startsWith('/snapshots/') || path.startsWith('/npm-registry')) {
        acquisitionRequests.push(path);
      }
    };
    context.on('request', recordAcquisition);

    try {
      const historical = await harness.startHistorical();
      await page.goto(historical.url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await pickStarter(page, 'vite8');
      await expect(page.locator('.rf-statusbar[data-storage-mode="opfs"]')).toBeVisible();
      await expectViteDevServerReady(page, 5174, OWNER_TIMEOUT);
      await openShellTerminal(page);

      const tag = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
      const projectAName = `Old Vite 8 A ${tag}`;
      const projectBName = `Stable Vite 7 B ${tag}`;
      const editText = `pre-policy-edit-${tag}`;
      await runTerminalLineSettled(page, `printf '${editText}\\n' > durable-pre-policy-edit.txt`);
      const projectAId = await saveScratchAs(page, projectAName);
      await expectViteDevServerReady(page, 5174, OWNER_TIMEOUT);
      await openShellTerminal(page);

      const oldManifestFile = await readActiveProjectText(page, 'package.json', 60_000);
      const oldManifestBytes = await readProjectFileFromOpfs(page, projectAId, 'package.json');
      const oldStampFile = await readActiveProjectText(
        page,
        'node_modules/.rifty-install-stamp.json',
        60_000,
      );
      expect(oldManifestFile.exists).toBe(true);
      expect(oldManifestBytes.exists).toBe(true);
      expect(oldStampFile.exists).toBe(true);
      const oldManifest = parseJson<PackageManifest>(oldManifestFile.text);
      expect(oldManifest.dependencies?.vite).toBe('8.0.16');
      expect(oldManifest.overrides).toBeUndefined();
      expectTrustedStamp(parseJson<InstallStamp>(oldStampFile.text), {
        projectId: projectAId,
        packageJsonText: oldManifestBytes.text,
        lockfileSha256: OLD_LOCKFILE_SHA256,
      });
      expect(await packageVersion(page, 'postcss')).toBe('8.5.23');
      expect(await readActiveProjectText(page, 'durable-pre-policy-edit.txt')).toEqual({
        exists: true,
        text: editText,
      });
      const oldDefinition = await definitionIdentityProof(page, projectAId);
      expect(oldDefinition).toMatchObject({
        catalogMatchesDefinition: true,
        expectedBuildIdentityMatches: true,
        snapshotId: OLD_SNAPSHOT_ID,
      });
      expect(oldDefinition.definitionIdentitySha256).toMatch(/^[0-9a-f]{64}$/u);
      const oldTree = await projectTreeDigest(page, projectAId);
      expect(oldTree.paths).toContain('/durable-pre-policy-edit.txt');
      expect(oldTree.paths).toContain('/node_modules/postcss/package.json');

      await pickStarter(page, 'project-files');
      await expectViteDevServerReady(page, 5174, OWNER_TIMEOUT);
      const projectBId = await saveScratchAs(page, projectBName);
      await expectViteDevServerReady(page, 5174, OWNER_TIMEOUT);
      await expectActiveProject(page, {
        name: projectBName,
        activeId: projectBId,
        inactiveId: projectAId,
      });
      const historicalCatalog = await catalogProof(page);
      expect(historicalCatalog.activeId).toBe(projectBId);
      expect(historicalCatalog.projectIds).toEqual([projectAId, projectBId].sort());
      expect(acquisitionRequests).toContain('/snapshots/vite8-node-modules.json.gz');
      await page.locator('.rf-launcher__close').click();

      await page.goto('about:blank');
      const current = await harness.startCurrent();
      expect(current.url).toBe(historical.url);
      acquisitionRequests.length = 0;
      await page.goto(current.url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
      await expect(page.locator('.rf-statusbar[data-storage-mode="opfs"]')).toBeVisible({
        timeout: OWNER_TIMEOUT,
      });
      await expectViteDevServerReady(page, 5174, OWNER_TIMEOUT);
      await expect(page.locator('[data-action="open-launcher"] .rf-chip__name')).toHaveText(
        projectBName,
        { timeout: OWNER_TIMEOUT },
      );
      const reopenedBSessionIds = await runningTerminalIds(page);
      expect(reopenedBSessionIds).toHaveLength(1);

      acquisitionRequests.length = 0;
      await openProjects(page);
      await armFirstMismatchToastState(page, projectAId, projectBId);
      await projectCard(page, projectAId).click();
      const mismatch = page.locator('.rf-toast[data-tone="error"]');
      await expect(mismatch).toContainText('ProjectDefinitionMismatchError', {
        timeout: OWNER_TIMEOUT,
      });
      await expect(mismatch).toContainText('has a different definition');
      expect(acquisitionRequests).toEqual([]);
      expect(await firstMismatchToastState(page)).toEqual({
        chip: projectBName,
        liveCount: 1,
        projectAActive: 'false',
        projectBActive: 'true',
      });
      await expectActiveProject(page, {
        name: projectBName,
        activeId: projectBId,
        inactiveId: projectAId,
      });
      expect(await catalogProof(page)).toEqual(historicalCatalog);
      const restoredBSessionIds = await runningTerminalIds(page);
      expect(restoredBSessionIds).toHaveLength(1);
      expect(await projectTreeDigest(page, projectAId)).toEqual(oldTree);

      const catalogBeforeCancel = await catalogProof(page);
      const sessionsBeforeCancel = await runningTerminalIds(page);
      const requestsBeforeCancel = [...acquisitionRequests];
      const resetDialog = await openResetDialog(page, projectAId);
      await resetDialog.getByRole('button', { name: 'Cancel' }).click();
      await expect(resetDialog).toHaveCount(0);
      expect(await projectTreeDigest(page, projectAId)).toEqual(oldTree);
      expect(await catalogProof(page)).toEqual(catalogBeforeCancel);
      expect(await runningTerminalIds(page)).toEqual(sessionsBeforeCancel);
      expect(acquisitionRequests).toEqual(requestsBeforeCancel);
      await expectActiveProject(page, {
        name: projectBName,
        activeId: projectBId,
        inactiveId: projectAId,
      });

      acquisitionRequests.length = 0;
      const projectIdsBeforeReset = (await catalogProof(page)).projectIds;
      const confirmDialog = await openResetDialog(page, projectAId);
      await confirmDialog.getByRole('button', { name: 'Reset files' }).click();
      await expect(confirmDialog).toHaveCount(0, { timeout: OWNER_TIMEOUT });
      await expectActiveProject(page, {
        name: projectBName,
        activeId: projectBId,
        inactiveId: projectAId,
      });
      expect((await catalogProof(page)).projectIds).toEqual(projectIdsBeforeReset);
      expect(acquisitionRequests).toEqual(['/snapshots/vite8-node-modules.json.gz']);
      const resetTree = await projectTreeDigest(page, projectAId);
      expect(resetTree.digest).not.toBe(oldTree.digest);
      expect(resetTree.paths).not.toContain('/durable-pre-policy-edit.txt');
      expect(
        await readProjectFileFromOpfs(page, projectAId, 'durable-pre-policy-edit.txt'),
      ).toEqual({
        exists: false,
        text: '',
      });

      await projectCard(page, projectAId).click();
      await expect(page.locator('[data-testid="launcher"]')).toHaveCount(0, {
        timeout: OWNER_TIMEOUT,
      });
      await expectViteDevServerReady(page, 5174, OWNER_TIMEOUT);
      await openShellTerminal(page);
      const currentManifestFile = await readActiveProjectText(page, 'package.json', 60_000);
      const currentManifestBytes = await readProjectFileFromOpfs(page, projectAId, 'package.json');
      const currentStampFile = await readActiveProjectText(
        page,
        'node_modules/.rifty-install-stamp.json',
        60_000,
      );
      expect(currentManifestFile.exists).toBe(true);
      expect(currentManifestBytes.exists).toBe(true);
      expect(currentStampFile.exists).toBe(true);
      const currentManifest = parseJson<PackageManifest>(currentManifestFile.text);
      expect(currentManifest.dependencies?.vite).toBe('8.0.16');
      expect(currentManifest.overrides?.['@napi-rs/wasm-runtime']).toBe(
        'npm:@napi-rs/wasm-runtime@1.1.6',
      );
      expectTrustedStamp(parseJson<InstallStamp>(currentStampFile.text), {
        projectId: projectAId,
        packageJsonText: currentManifestBytes.text,
        lockfileSha256: CURRENT_LOCKFILE_SHA256,
      });
      expect(await packageVersion(page, 'postcss')).toBe('8.5.24');
      expect(await packageVersion(page, '@rolldown/binding-wasm32-wasi')).toBe('1.0.3');
      expect(await packageVersion(page, '@emnapi/core')).toBe('1.10.0');
      expect(await packageVersion(page, '@emnapi/runtime')).toBe('1.10.0');
      expect(await packageVersion(page, '@napi-rs/wasm-runtime')).toBe('1.1.6');
      expect(await readActiveProjectText(page, 'durable-pre-policy-edit.txt')).toEqual({
        exists: false,
        text: '',
      });
      const currentDefinition = await definitionIdentityProof(page, projectAId);
      expect(currentDefinition).toMatchObject({
        catalogMatchesDefinition: true,
        expectedBuildIdentityMatches: true,
        snapshotId: CURRENT_SNAPSHOT_ID,
      });
      expect(currentDefinition.definitionIdentitySha256).not.toBe(
        oldDefinition.definitionIdentitySha256,
      );
      await runTerminalLineSettled(
        page,
        "printf \"await import('rolldown'); console.log('rolldown-wasi-ok')\\n\" > rolldown-wasi-oracle.mjs",
      );
      await runTerminalLineSettled(
        page,
        'NAPI_RS_FORCE_WASI=1 node rolldown-wasi-oracle.mjs',
        60_000,
      );
      await expectTerminalContains(page, 'rolldown-wasi-ok', 20_000);
      await proveVite8BuildAndPreview(page);

      await switchProject(page, projectBId);
      await expectViteDevServerReady(page, 5174, OWNER_TIMEOUT);
      await expect(page.locator('[data-action="open-launcher"] .rf-chip__name')).toHaveText(
        projectBName,
      );

      acquisitionRequests.length = 0;
      await blockAcquisition(context);
      await switchProject(page, projectAId);
      await expectViteDevServerReady(page, 5174, OWNER_TIMEOUT);
      expect(acquisitionRequests).toEqual([]);
      await proveVite8BuildAndPreview(page);
      expect(acquisitionRequests).toEqual([]);
      await expect(page.locator('[data-action="open-launcher"] .rf-chip__name')).toHaveText(
        projectAName,
      );
      expect(await catalogProof(page)).toMatchObject({
        activeId: projectAId,
        projectIds: [projectAId, projectBId].sort(),
      });
    } finally {
      context.off('request', recordAcquisition);
      await harness.close();
    }
  });
});

async function blockAcquisition(context: BrowserContext): Promise<void> {
  await context.route('**/*', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/snapshots/') || path.startsWith('/npm-registry')) {
      await route.abort();
      return;
    }
    await route.continue();
  });
}
