import type { Page, Request, Route } from '@playwright/test';
import type * as NativeObserver from '../../browser-unit/fixtures/native-replica-observer.ts';

interface NativeProjectState {
  readonly projectId: string;
  readonly root: string;
  readonly manifest: string;
  readonly marker: string;
  readonly claim: Readonly<Record<string, unknown>> | null;
  readonly lockfileSha256: string | undefined;
  readonly entries: Readonly<Record<string, string>>;
}

/** Read every retained catalog/project entry; hashes keep large dependency bytes off the wire. */
export function nativeProjectState(page: Page, projectName: string): Promise<NativeProjectState> {
  return page.evaluate(
    async ({ projectName, observerUrl }) => {
      const origin = await navigator.storage.getDirectory();
      const observer = (await import(/* @vite-ignore */ observerUrl)) as typeof NativeObserver;
      const native = await observer.nativeReplicaEntries(origin);
      const read = async (path: string) => {
        const entry = native.get(path);
        if (entry?.kind !== 'file' || entry.bytes === undefined)
          throw new DOMException(`Missing committed native file: ${path}`, 'NotFoundError');
        return entry.bytes;
      };
      const hash = async (bytes: Uint8Array<ArrayBuffer>) =>
        Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('');
      const decoder = new TextDecoder();
      const catalog = JSON.parse(
        decoder.decode(await read('/.rifty/workbench/playground/catalog.json')),
      ) as { active: { kind: string; id?: string }; projects: { id: string; name: string }[] };
      const project = catalog.projects.find((entry) => entry.name === projectName);
      if (
        project === undefined ||
        catalog.active.kind !== 'project' ||
        catalog.active.id !== project.id
      )
        throw new Error(`Saved project ${projectName} is not the active native catalog entry`);
      const root = `/.rifty/workbench/v2/projects/${project.id}/tree`;
      const entries: Record<string, string> = {};
      // Entire committed scopes; no live-owner cache or physical per-file assumption.
      for (const entry of native.values()) {
        if (
          !['/.rifty/workbench/playground', '/.rifty/workbench/v2/projects'].some(
            (root) => entry.path === root || entry.path.startsWith(`${root}/`),
          )
        )
          continue;
        if (entry.kind === 'dir') entries[entry.path] = 'directory';
        if (entry.kind === 'file' && entry.bytes !== undefined)
          entries[entry.path] = `file:${entry.bytes.length}:${await hash(entry.bytes)}`;
      }
      let claim: Readonly<Record<string, unknown>> | null = null;
      try {
        const value: unknown = JSON.parse(
          decoder.decode(await read(`${root}/node_modules/.rifty-install-stamp.json`)),
        );
        if (value !== null && typeof value === 'object' && !Array.isArray(value))
          claim = value as Readonly<Record<string, unknown>>;
      } catch (error) {
        if (
          !(error instanceof SyntaxError) &&
          !(error instanceof DOMException && error.name === 'NotFoundError')
        )
          throw error;
      }
      const lockEntry = entries[`${root}/package-lock.json`];
      return {
        projectId: project.id,
        root,
        manifest: decoder.decode(await read(`${root}/package.json`)),
        marker: decoder.decode(await read(`${root}/data.txt`)),
        claim,
        lockfileSha256: lockEntry?.startsWith('file:') ? lockEntry.split(':')[2] : undefined,
        entries,
      };
    },
    {
      projectName,
      observerUrl: `/@fs${process.cwd()}/tests/browser-unit/fixtures/native-replica-observer.ts`,
    },
  );
}

/** Independent durable receipt oracle, against the known-running project's runtime identity. */
export function hasMatchingDurableClaim(
  state: NativeProjectState,
  reference: NativeProjectState,
): boolean {
  const claim = state.claim;
  return (
    claim !== null &&
    reference.claim !== null &&
    claim.version === 4 &&
    claim.root === state.root &&
    claim.slug === reference.claim.slug &&
    claim.installArtifactIdentity === reference.claim.installArtifactIdentity &&
    claim.packageJsonText === state.manifest &&
    claim.lockfileSha256 === state.lockfileSha256 &&
    claim.durability === undefined &&
    claim.epoch === undefined &&
    typeof claim.packages === 'number' &&
    Number.isSafeInteger(claim.packages) &&
    claim.packages > 0
  );
}

export function retainedChanges(before: NativeProjectState, after: NativeProjectState) {
  const paths = [...new Set([...Object.keys(before.entries), ...Object.keys(after.entries)])]
    .filter((path) => before.entries[path] !== after.entries[path])
    .sort();
  return { total: paths.length, sample: paths.slice(0, 12) };
}

/** Hold only the next real owner script, after reload has terminated the previous owner. */
export async function prepareOwnerReloadObservation(page: Page, projectName: string) {
  const deployment = await page.evaluate(async () => {
    const hostUrl = '/src/adapters/playground-workbench-host.ts';
    const registryUrl = '/src/templates/registry.ts';
    const [{ playgroundWorkbenchOptions }, { resolveProjectSpec }] = await Promise.all([
      import(/* @vite-ignore */ hostUrl),
      import(/* @vite-ignore */ registryUrl),
    ]);
    const options = playgroundWorkbenchOptions();
    const acquisition = options.packageAcquisition;
    return {
      owner: new URL(options.deployment.workers.owner, location.href).href,
      prefixes: [
        acquisition.registryUrl,
        acquisition.eddy?.resolverUrl,
        acquisition.eddy?.bundleBaseUrl,
      ]
        .filter((value): value is string => typeof value === 'string')
        .map((value) => new URL(value, location.href).href.replace(/\/$/, '')),
      snapshot: new URL(resolveProjectSpec('vite').bakedNodeModulesUrl, location.href).href,
    };
  });
  const reference = await nativeProjectState(page, projectName);
  let release: () => void = () => {};
  let entered: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reached = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const handler = async (route: Route) => {
    entered();
    await held;
    await route.continue();
  };
  await page.route(deployment.owner, handler);
  let observing = false;
  const requests = { total: 0, sample: [] as string[] };
  const onRequest = (request: Request) => {
    if (!observing) return;
    const url = request.url();
    if (
      url === deployment.snapshot ||
      deployment.prefixes.some(
        (prefix) => url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`),
      )
    ) {
      requests.total += 1;
      if (requests.sample.length < 12) requests.sample.push(url);
    }
  };
  page.context().on('request', onRequest);
  return {
    reference,
    requests,
    async reload() {
      observing = true;
      await page.reload();
      await reached;
      return nativeProjectState(page, projectName);
    },
    resume: release,
    async close() {
      release();
      await page.unroute(deployment.owner, handler);
      page.context().off('request', onRequest);
    },
  };
}
