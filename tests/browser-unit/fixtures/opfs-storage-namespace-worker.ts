/// <reference lib="webworker" />

import { installOpfsFs } from '@riftydev/vfs/internal';

const scope = globalThis as unknown as DedicatedWorkerGlobalScope;

interface RunRequest {
  readonly hostName: string;
  readonly nsA: string;
  readonly nsB: string;
  readonly blockedName: string;
}

export interface NamespaceRunResult {
  readonly hostVisibleInA: boolean;
  readonly hostVisibleInASync: boolean;
  readonly aRootNames: readonly string[];
  readonly originAfterA: readonly string[];
  readonly projectAtOriginRoot: boolean;
  readonly projectUnderA: boolean;
  readonly bSeesProject: boolean;
  readonly bRootNames: readonly string[];
  readonly aReopenSeesProject: boolean;
  readonly hostBytesUnchanged: boolean;
  readonly invalidThrew: boolean;
  readonly originAfterInvalid: readonly string[];
  readonly blockedFailed: boolean;
  readonly aUnchangedAfterBlocked: boolean;
}

async function originRoot(): Promise<FileSystemDirectoryHandle> {
  const dir = await navigator.storage.getDirectory();
  if (!dir) throw new Error('OPFS getDirectory returned undefined');
  return dir;
}

async function listNames(dir: FileSystemDirectoryHandle): Promise<string[]> {
  const names: string[] = [];
  for await (const [name] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
    names.push(name);
  }
  return names.sort();
}

async function readText(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<string | undefined> {
  try {
    const file = await (await dir.getFileHandle(name)).getFile();
    return await file.text();
  } catch {
    return undefined;
  }
}

async function writeHost(dir: FileSystemDirectoryHandle, hostName: string): Promise<void> {
  const file = await dir.getFileHandle(hostName, { create: true });
  const writable = await file.createWritable();
  await writable.write(new TextEncoder().encode('unrelated-host'));
  await writable.close();
}

scope.onmessage = (event: MessageEvent<RunRequest>) => {
  void (async () => {
    const { hostName, nsA, nsB, blockedName } = event.data;
    const origin = await originRoot();
    await writeHost(origin, hostName);

    let invalidThrew = false;
    const originBefore = await listNames(origin);
    try {
      await installOpfsFs({ namespace: '..' });
    } catch (error) {
      invalidThrew = error instanceof Error && /storage\.namespace/.test(error.message);
    }
    const originAfterInvalid = await listNames(origin);
    if (originAfterInvalid.join('\0') !== originBefore.join('\0')) {
      throw new Error('invalid namespace mutated origin children');
    }

    const first = await installOpfsFs({ namespace: nsA });
    const aRootNames = (await first.vfs.readdir('/')).map((e) => e.name);
    const hostVisibleInA = await first.vfs.exists(`/${hostName}`);
    const hostVisibleInASync = first.fsSync.existsSync(`/${hostName}`);
    first.fsSync.writeFileSync('/project.txt', new TextEncoder().encode('from-a'));
    const flushA = await first.fsSync.flush();
    if (flushA.total !== 0) throw new Error(`ns-a flush failed: ${flushA.total}`);

    const originAfterA = await listNames(origin);
    const projectAtOriginRoot = (await readText(origin, 'project.txt')) !== undefined;
    let projectUnderA = false;
    try {
      const nsADir = await origin.getDirectoryHandle(nsA);
      projectUnderA = (await readText(nsADir, 'project.txt')) === 'from-a';
    } catch {
      projectUnderA = false;
    }

    const second = await installOpfsFs({ namespace: nsB });
    const bSeesProject = await second.vfs.exists('/project.txt');
    const bRootNames = (await second.vfs.readdir('/')).map((e) => e.name);

    const reopen = await installOpfsFs({ namespace: nsA });
    const aReopenSeesProject = (await reopen.vfs.readFileText('/project.txt')) === 'from-a';
    const hostBytesUnchanged = (await readText(origin, hostName)) === 'unrelated-host';

    await origin.getFileHandle(blockedName, { create: true });
    let blockedFailed = false;
    try {
      await installOpfsFs({ namespace: blockedName });
    } catch {
      blockedFailed = true;
    }
    const afterBlocked = await installOpfsFs({ namespace: nsA });
    const aUnchangedAfterBlocked =
      (await afterBlocked.vfs.readFileText('/project.txt')) === 'from-a';

    const result: NamespaceRunResult = {
      hostVisibleInA,
      hostVisibleInASync,
      aRootNames,
      originAfterA,
      projectAtOriginRoot,
      projectUnderA,
      bSeesProject,
      bRootNames,
      aReopenSeesProject,
      hostBytesUnchanged,
      invalidThrew,
      originAfterInvalid,
      blockedFailed,
      aUnchangedAfterBlocked,
    };
    scope.postMessage({ ok: true, result });
  })().catch((error: unknown) => {
    scope.postMessage({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  });
};
