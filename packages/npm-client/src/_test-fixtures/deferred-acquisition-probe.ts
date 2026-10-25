import { setImmediate } from 'node:timers/promises';
import { MemoryVfs } from '@riftydev/vfs';
import { install } from '../installer.ts';
import { RegistryClient } from '../registry.ts';
import { loadOfficialSassEntries } from './sass-embedded-substitution.ts';

const entries = await loadOfficialSassEntries();
const results = [];
for (const hook of [false, true]) {
  const unhandled: unknown[] = [];
  const observe = (error: unknown) => unhandled.push(error);
  process.on('unhandledRejection', observe);
  let releaseMetadata!: () => void;
  const heldMetadata = new Promise<void>((resolve) => {
    releaseMetadata = resolve;
  });
  let notifyRejection!: () => void;
  const rejectedTarball = new Promise<void>((resolve) => {
    notifyRejection = resolve;
  });
  const fault = new TypeError('controlled Sass tarball delivery failure');
  const registry = new RegistryClient({
    baseUrl: 'https://registry.fixture',
    maxRetries: 0,
    fetch: async (url) => {
      if (url === entries[0]?.manifest.dist.tarball) {
        notifyRejection();
        throw fault;
      }
      const archive = entries.find((entry) => entry.manifest.dist.tarball === url);
      if (archive) return new Response(archive.tarball as Uint8Array<ArrayBuffer>);
      const entry = entries.find(
        (entry) => url === `https://registry.fixture/${entry.manifest.name}`,
      );
      if (!entry) return new Response('optional dependency absent', { status: 404 });
      if (entry.manifest.name === 'chokidar') await heldMetadata;
      return new Response(
        JSON.stringify({
          name: entry.manifest.name,
          versions: { [entry.manifest.version]: entry.manifest },
        }),
      );
    },
  });
  const vfs = new MemoryVfs();
  await vfs.mkdir('/project', { recursive: true });
  await vfs.writeFile(
    '/project/package.json',
    JSON.stringify({ name: 'proof', version: '1.0.0', dependencies: { sass: '1.100.0' } }),
  );
  const reported: string[] = [];
  const outcome = install({
    vfs,
    cwd: '/project',
    registry,
    ...(hook ? { onPackage: (entry) => reported.push(entry.name) } : {}),
  }).then(
    () => ({ sameFailure: false }),
    (error: unknown) => ({ sameFailure: error === fault }),
  );
  await rejectedTarball;
  // Allow the host's unhandled-rejection turn while descendant metadata is held.
  await setImmediate();
  await setImmediate();
  releaseMetadata();
  const result = await outcome;
  await setImmediate();
  process.removeListener('unhandledRejection', observe);
  results.push({
    hook,
    unhandled: unhandled.length,
    ...result,
    lockPublished: await vfs.exists('/project/package-lock.json'),
    failedPackageReported: reported.includes('sass'),
  });
}
console.log(JSON.stringify(results));
